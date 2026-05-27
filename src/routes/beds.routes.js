const express = require('express');
const router = express.Router();
const { query, transaction } = require('../db');
const authMiddleware = require('../middleware/auth.middleware');
const { emit } = require('../websockets');
const config = require('../config/app.config');
const {
  BED_STATUSES,
  normalizeString,
  parsePositiveInt,
  requireFields,
} = require('../utils/validation');

const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  return next();
};

const logHistory = async (client, {
  bedId,
  actionType,
  patientName = null,
  fromStatus = null,
  toStatus = null,
  performedBy = null,
  notes = null,
}) => {
  try {
    await client.query(`
      INSERT INTO bed_history
        (bed_id, action_type, patient_name, from_status, to_status, performed_by, notes, timestamp)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    `, [bedId, actionType, patientName, fromStatus, toStatus, performedBy, notes]);
  } catch (err) {
    console.warn('History log skipped:', err.message);
  }
};

router.get('/', authMiddleware, async (req, res) => {
  const { specialty_type } = req.query;

  const sql = `
    SELECT
      b.bed_id,
      b.bed_number,
      b.hospital_id,
      b.ward_name,
      b.specialty_type,
      b.current_status,
      b.cleaning_started_at,
      b.updated_at,
      a.patient_name,
      a.admitted_at
    FROM beds b
    LEFT JOIN admissions a ON b.bed_id = a.bed_id AND a.discharged_at IS NULL
    WHERE ($1 = 'All' OR $1 IS NULL OR b.specialty_type = $1)
    ORDER BY b.bed_id ASC;
  `;

  try {
    const result = await query(sql, [specialty_type]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to retrieve bed data.' });
  }
});

router.get('/cleaning/overdue', authMiddleware, async (req, res) => {
  try {
    const result = await query(`
      SELECT bed_id, bed_number, ward_name, specialty_type, cleaning_started_at
      FROM beds
      WHERE current_status = 'CLEANING'
        AND cleaning_started_at IS NOT NULL
        AND cleaning_started_at <= NOW() - ($1::int * INTERVAL '1 minute')
      ORDER BY cleaning_started_at ASC;
    `, [config.cleaningSlaMinutes]);
    res.json(result.rows);
  } catch (err) {
    console.error('Cleaning overdue query failed:', err);
    res.status(500).json({ error: 'Failed to load overdue cleaning beds.' });
  }
});

router.post('/cleaning/auto-release', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const released = await transaction(async (client) => {
      const overdue = await client.query(`
        SELECT bed_id, bed_number, current_status
        FROM beds
        WHERE current_status = 'CLEANING'
          AND cleaning_started_at IS NOT NULL
          AND cleaning_started_at <= NOW() - ($1::int * INTERVAL '1 minute')
        FOR UPDATE;
      `, [config.cleaningSlaMinutes]);

      for (const bed of overdue.rows) {
        await client.query(`
          UPDATE beds
          SET current_status = 'AVAILABLE', cleaning_started_at = NULL, updated_at = NOW()
          WHERE bed_id = $1
        `, [bed.bed_id]);
        await logHistory(client, {
          bedId: bed.bed_id,
          actionType: 'AUTO_MARK_AVAILABLE',
          fromStatus: bed.current_status,
          toStatus: 'AVAILABLE',
          performedBy: req.user?.username || req.user?.role,
          notes: `Cleaning SLA exceeded ${config.cleaningSlaMinutes} minutes.`,
        });
      }

      return overdue.rows;
    });

    emit('beds:changed', { reason: 'cleaning-auto-release', released });
    res.json({ message: 'Overdue cleaning beds released.', released });
  } catch (err) {
    console.error('Auto-release failed:', err);
    res.status(500).json({ error: 'Failed to auto-release cleaning beds.' });
  }
});

router.get('/:bedId/history', authMiddleware, async (req, res) => {
  const bedId = parsePositiveInt(req.params.bedId);
  if (!bedId) return res.status(400).json({ error: 'Invalid bed ID.' });

  try {
    const result = await query(`
      SELECT history_id, bed_id, action_type, patient_name, from_status, to_status, performed_by, notes, timestamp
      FROM bed_history
      WHERE bed_id = $1
      ORDER BY timestamp DESC
      LIMIT 25;
    `, [bedId]);
    res.json(result.rows);
  } catch (err) {
    if (err.code === '42P01') return res.json([]);
    console.error('History query failed:', err);
    res.status(500).json({ error: 'Failed to load bed history.' });
  }
});

router.post('/', authMiddleware, requireAdmin, async (req, res) => {
  const validationError = requireFields(req.body, ['bed_number', 'ward_name', 'specialty_type']);
  if (validationError) return res.status(400).json({ error: validationError });

  const bedNumber = normalizeString(req.body.bed_number);
  const wardName = normalizeString(req.body.ward_name);
  const specialtyType = normalizeString(req.body.specialty_type);
  const currentStatus = normalizeString(req.body.current_status || 'AVAILABLE').toUpperCase();
  const hospitalId = req.body.hospital_id ? parsePositiveInt(req.body.hospital_id) : null;

  if (!BED_STATUSES.has(currentStatus)) {
    return res.status(400).json({ error: 'Invalid bed status.' });
  }

  try {
    const created = await transaction(async (client) => {
      const result = await client.query(`
        INSERT INTO beds
          (bed_number, hospital_id, ward_name, specialty_type, current_status, cleaning_started_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, CASE WHEN $5 = 'CLEANING' THEN NOW() ELSE NULL END, NOW())
        RETURNING *;
      `, [bedNumber, hospitalId, wardName, specialtyType, currentStatus]);

      await logHistory(client, {
        bedId: result.rows[0].bed_id,
        actionType: 'BED_CREATED',
        toStatus: currentStatus,
        performedBy: req.user?.username || req.user?.role,
      });

      return result.rows[0];
    });

    emit('beds:changed', { reason: 'bed-created', bed: created });
    res.status(201).json(created);
  } catch (err) {
    console.error('Create bed failed:', err);
    res.status(500).json({ error: 'Failed to create bed.' });
  }
});

router.post('/:bedId/status', authMiddleware, async (req, res) => {
  const bedId = parsePositiveInt(req.params.bedId);
  const newStatus = normalizeString(req.body.new_status).toUpperCase();
  const patientName = normalizeString(req.body.patient_name);

  if (!bedId) return res.status(400).json({ error: 'Invalid bed ID.' });
  if (!BED_STATUSES.has(newStatus)) return res.status(400).json({ error: 'Invalid bed status.' });
  if (newStatus === 'OCCUPIED' && !patientName) {
    return res.status(400).json({ error: 'Patient name is required when admitting a patient.' });
  }

  try {
    const updated = await transaction(async (client) => {
      const bedResult = await client.query('SELECT * FROM beds WHERE bed_id = $1 FOR UPDATE', [bedId]);
      if (bedResult.rowCount === 0) {
        const error = new Error('Bed not found.');
        error.statusCode = 404;
        throw error;
      }

      const bed = bedResult.rows[0];

      if (newStatus === 'OCCUPIED' && bed.current_status === 'OCCUPIED') {
        const error = new Error('Bed is already occupied.');
        error.statusCode = 409;
        throw error;
      }

      await client.query(`
        UPDATE beds
        SET current_status = $1,
            cleaning_started_at = CASE WHEN $1 = 'CLEANING' THEN NOW() ELSE NULL END,
            updated_at = NOW()
        WHERE bed_id = $2
      `, [newStatus, bedId]);

      if (newStatus === 'OCCUPIED') {
        await client.query(`
          UPDATE admissions
          SET discharged_at = NOW()
          WHERE bed_id = $1 AND discharged_at IS NULL
        `, [bedId]);
        await client.query(`
          INSERT INTO admissions (patient_name, bed_id, admitted_at)
          VALUES ($1, $2, NOW())
        `, [patientName, bedId]);
      } else {
        await client.query(`
          UPDATE admissions
          SET discharged_at = NOW()
          WHERE bed_id = $1 AND discharged_at IS NULL
        `, [bedId]);
      }

      await logHistory(client, {
        bedId,
        actionType: newStatus === 'OCCUPIED' ? 'ADMISSION' : newStatus === 'CLEANING' ? 'DISCHARGE_TO_CLEANING' : 'MARK_AVAILABLE',
        patientName: patientName || null,
        fromStatus: bed.current_status,
        toStatus: newStatus,
        performedBy: req.user?.username || req.user?.role,
      });

      const refreshed = await client.query(`
        SELECT b.*, a.patient_name, a.admitted_at
        FROM beds b
        LEFT JOIN admissions a ON b.bed_id = a.bed_id AND a.discharged_at IS NULL
        WHERE b.bed_id = $1
      `, [bedId]);

      return refreshed.rows[0];
    });

    emit('beds:changed', { reason: 'status-updated', bed: updated });
    res.json({ message: 'Status updated successfully', bed: updated });
  } catch (err) {
    console.error('Status update failed:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Database transaction failed' });
  }
});

router.post('/transfer', authMiddleware, async (req, res) => {
  const sourceBedId = parsePositiveInt(req.body.sourceBedId);
  const targetBedId = parsePositiveInt(req.body.targetBedId);
  const patientName = normalizeString(req.body.patientName);

  if (!sourceBedId || !targetBedId) {
    return res.status(400).json({ error: 'Source and target bed IDs are required.' });
  }

  if (sourceBedId === targetBedId) {
    return res.status(400).json({ error: 'Source and target beds must be different.' });
  }

  if (!patientName) {
    return res.status(400).json({ error: 'Patient name is required.' });
  }

  try {
    const transfer = await transaction(async (client) => {
      const beds = await client.query(`
        SELECT * FROM beds
        WHERE bed_id IN ($1, $2)
        ORDER BY bed_id
        FOR UPDATE
      `, [sourceBedId, targetBedId]);

      const source = beds.rows.find((bed) => Number(bed.bed_id) === sourceBedId);
      const target = beds.rows.find((bed) => Number(bed.bed_id) === targetBedId);

      if (!source || !target) {
        const error = new Error('Source or target bed not found.');
        error.statusCode = 404;
        throw error;
      }

      if (target.current_status !== 'AVAILABLE') {
        const error = new Error('Target bed is not available.');
        error.statusCode = 409;
        throw error;
      }

      await client.query(`
        UPDATE admissions
        SET discharged_at = NOW()
        WHERE bed_id = $1 AND discharged_at IS NULL
      `, [sourceBedId]);
      await client.query(`
        UPDATE beds
        SET current_status = 'CLEANING', cleaning_started_at = NOW(), updated_at = NOW()
        WHERE bed_id = $1
      `, [sourceBedId]);

      await client.query(`
        INSERT INTO admissions (patient_name, bed_id, admitted_at)
        VALUES ($1, $2, NOW())
      `, [patientName, targetBedId]);
      await client.query(`
        UPDATE beds
        SET current_status = 'OCCUPIED', cleaning_started_at = NULL, updated_at = NOW()
        WHERE bed_id = $1
      `, [targetBedId]);

      await logHistory(client, {
        bedId: sourceBedId,
        actionType: 'TRANSFER_OUT',
        patientName,
        fromStatus: source.current_status,
        toStatus: 'CLEANING',
        performedBy: req.user?.username || req.user?.role,
        notes: `Transferred to bed ${targetBedId}.`,
      });
      await logHistory(client, {
        bedId: targetBedId,
        actionType: 'TRANSFER_IN',
        patientName,
        fromStatus: target.current_status,
        toStatus: 'OCCUPIED',
        performedBy: req.user?.username || req.user?.role,
        notes: `Transferred from bed ${sourceBedId}.`,
      });

      return { sourceBedId, targetBedId, patientName };
    });

    emit('beds:changed', { reason: 'patient-transferred', transfer });
    emit('transfers:changed', { reason: 'patient-transferred', transfer });
    res.json({ success: true, message: 'Patient transferred successfully', transfer });
  } catch (err) {
    console.error('Transfer failed:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Transfer transaction failed' });
  }
});

router.delete('/:bedId', authMiddleware, requireAdmin, async (req, res) => {
  const bedId = parsePositiveInt(req.params.bedId);
  if (!bedId) return res.status(400).json({ error: 'Invalid bed ID.' });

  try {
    await transaction(async (client) => {
      const admissionCount = await client.query(
        'SELECT COUNT(*)::int AS count FROM admissions WHERE bed_id = $1',
        [bedId]
      );
      if (admissionCount.rows[0].count > 0) {
        const error = new Error('Cannot delete bed: admission records exist for this bed.');
        error.statusCode = 400;
        throw error;
      }

      await logHistory(client, {
        bedId,
        actionType: 'BED_DELETED',
        performedBy: req.user?.username || req.user?.role,
      });

      await client.query('DELETE FROM beds WHERE bed_id = $1', [bedId]);
    });

    emit('beds:changed', { reason: 'bed-deleted', bed_id: bedId });
    res.json({ message: 'Bed deleted successfully.' });
  } catch (err) {
    console.error('Error deleting bed:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Cannot delete bed. Server error.' });
  }
});

module.exports = router;

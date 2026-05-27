const express = require('express');
const router = express.Router();
const { query, transaction } = require('../db');
const authMiddleware = require('../middleware/auth.middleware');
const { emit } = require('../websockets');
const {
  PRIORITIES,
  TRANSFER_STATUSES,
  normalizeString,
  parsePositiveInt,
  requireFields,
} = require('../utils/validation');

const logHistory = async (client, payload) => {
  try {
    await client.query(`
      INSERT INTO bed_history
        (bed_id, action_type, patient_name, from_status, to_status, performed_by, notes, timestamp)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    `, [
      payload.bedId,
      payload.actionType,
      payload.patientName || null,
      payload.fromStatus || null,
      payload.toStatus || null,
      payload.performedBy || null,
      payload.notes || null,
    ]);
  } catch (err) {
    console.warn('History log skipped:', err.message);
  }
};

router.post('/', authMiddleware, async (req, res) => {
  const validationError = requireFields(req.body, ['patient_name', 'from_ward', 'required_specialty', 'priority']);
  if (validationError) return res.status(400).json({ error: validationError });

  const patientName = normalizeString(req.body.patient_name);
  const fromWard = normalizeString(req.body.from_ward);
  const requiredSpecialty = normalizeString(req.body.required_specialty);
  const priority = normalizeString(req.body.priority);
  const clinicalNotes = normalizeString(req.body.clinical_notes);

  if (!PRIORITIES.has(priority)) {
    return res.status(400).json({ error: 'Invalid transfer priority.' });
  }

  const sql = `
    INSERT INTO transfer_requests
      (patient_name, from_ward, required_specialty, priority, clinical_notes, status, requested_by, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, 'PENDING', $6, NOW(), NOW())
    RETURNING *;
  `;

  try {
    const result = await query(sql, [
      patientName,
      fromWard,
      requiredSpecialty,
      priority,
      clinicalNotes,
      req.user?.username || req.user?.user_id || null,
    ]);

    emit('transfers:changed', { reason: 'transfer-created', request: result.rows[0] });
    res.status(201).json({ message: 'Transfer request created.', request: result.rows[0] });
  } catch (err) {
    console.error('Error creating transfer:', err);
    res.status(500).json({ error: 'Failed to create transfer request.' });
  }
});

router.get('/', authMiddleware, async (req, res) => {
  const status = normalizeString(req.query.status).toUpperCase() || null;

  if (status && !TRANSFER_STATUSES.has(status)) {
    return res.status(400).json({ error: 'Invalid transfer status.' });
  }

  const sql = `
    SELECT * FROM transfer_requests
    WHERE ($1::text IS NULL OR status = $1)
    ORDER BY
      CASE
        WHEN priority = 'Emergency' THEN 1
        WHEN priority = 'High' THEN 2
        WHEN priority = 'Medium' THEN 3
        ELSE 4
      END ASC,
      created_at ASC;
  `;

  try {
    const result = await query(sql, [status]);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching transfers:', err);
    res.status(500).json({ error: 'Failed to fetch transfer requests.' });
  }
});

router.patch('/:id', authMiddleware, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  const newStatus = normalizeString(req.body.new_status).toUpperCase();
  const assignedBedId = req.body.assigned_bed_id ? parsePositiveInt(req.body.assigned_bed_id) : null;
  const decisionNotes = normalizeString(req.body.decision_notes);
  const rejectReason = normalizeString(req.body.reject_reason);

  if (!id) return res.status(400).json({ error: 'Invalid request ID.' });
  if (!TRANSFER_STATUSES.has(newStatus)) return res.status(400).json({ error: 'Invalid transfer status.' });
  if (newStatus === 'APPROVED' && !assignedBedId) {
    return res.status(400).json({ error: 'Assigned bed is required for approval.' });
  }
  if (newStatus === 'REJECTED' && !rejectReason) {
    return res.status(400).json({ error: 'Reject reason is required.' });
  }

  try {
    const updatedRequest = await transaction(async (client) => {
      const requestResult = await client.query(`
        SELECT *
        FROM transfer_requests
        WHERE request_id = $1
        FOR UPDATE;
      `, [id]);

      if (requestResult.rowCount === 0) {
        const error = new Error('Request not found.');
        error.statusCode = 404;
        throw error;
      }

      const request = requestResult.rows[0];

      if (newStatus === 'APPROVED') {
        const targetResult = await client.query('SELECT * FROM beds WHERE bed_id = $1 FOR UPDATE', [assignedBedId]);
        if (targetResult.rowCount === 0) {
          const error = new Error('Assigned bed not found.');
          error.statusCode = 404;
          throw error;
        }

        const target = targetResult.rows[0];
        if (target.current_status !== 'AVAILABLE') {
          const error = new Error('Assigned bed is no longer available.');
          error.statusCode = 409;
          throw error;
        }

        const sourceAdmission = await client.query(`
          SELECT bed_id
          FROM admissions
          WHERE patient_name = $1 AND discharged_at IS NULL
          LIMIT 1
          FOR UPDATE;
        `, [request.patient_name]);

        if (sourceAdmission.rows.length > 0) {
          const sourceBedId = sourceAdmission.rows[0].bed_id;
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
          await logHistory(client, {
            bedId: sourceBedId,
            actionType: 'TRANSFER_OUT',
            patientName: request.patient_name,
            toStatus: 'CLEANING',
            performedBy: req.user?.username || req.user?.role,
            notes: `Transfer request ${id} approved.`,
          });
        }

        await client.query(`
          INSERT INTO admissions (patient_name, bed_id, admitted_at)
          VALUES ($1, $2, NOW())
        `, [request.patient_name, assignedBedId]);
        await client.query(`
          UPDATE beds
          SET current_status = 'OCCUPIED', cleaning_started_at = NULL, updated_at = NOW()
          WHERE bed_id = $1
        `, [assignedBedId]);
        await logHistory(client, {
          bedId: assignedBedId,
          actionType: 'TRANSFER_IN',
          patientName: request.patient_name,
          fromStatus: target.current_status,
          toStatus: 'OCCUPIED',
          performedBy: req.user?.username || req.user?.role,
          notes: `Transfer request ${id} approved.`,
        });
      }

      const updateResult = await client.query(`
        UPDATE transfer_requests
        SET status = $1,
            assigned_bed_id = COALESCE($2, assigned_bed_id),
            decision_notes = NULLIF($3, ''),
            reject_reason = NULLIF($4, ''),
            decided_by = $5,
            decided_at = CASE WHEN $1 IN ('APPROVED', 'REJECTED') THEN NOW() ELSE decided_at END,
            completed_at = CASE WHEN $1 = 'COMPLETED' THEN NOW() ELSE completed_at END,
            updated_at = NOW()
        WHERE request_id = $6
        RETURNING *;
      `, [
        newStatus,
        assignedBedId,
        decisionNotes,
        rejectReason,
        req.user?.username || req.user?.user_id || null,
        id,
      ]);

      return updateResult.rows[0];
    });

    emit('transfers:changed', { reason: 'transfer-updated', request: updatedRequest });
    if (newStatus === 'APPROVED') emit('beds:changed', { reason: 'transfer-approved', request: updatedRequest });

    res.json({
      message: `Transfer ${newStatus}`,
      request: updatedRequest,
    });
  } catch (err) {
    console.error('Transaction Error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to process transfer.' });
  }
});

module.exports = router;

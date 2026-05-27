const express = require('express');
const router = express.Router();
const { query } = require('../db');
const authMiddleware = require('../middleware/auth.middleware');
const { normalizeString, parsePositiveInt, requireFields } = require('../utils/validation');

const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'ADMIN') return res.status(403).json({ error: 'Forbidden' });
  return next();
};

router.get('/', authMiddleware, async (req, res) => {
  try {
    const result = await query(`
      SELECT id, name, location, lat, lng, phone, updated_at
      FROM hospitals
      ORDER BY name ASC;
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Load hospitals failed:', err);
    res.status(500).json({ error: 'Failed to load hospitals.' });
  }
});

router.post('/', authMiddleware, requireAdmin, async (req, res) => {
  const validationError = requireFields(req.body, ['name', 'location']);
  if (validationError) return res.status(400).json({ error: validationError });

  try {
    const result = await query(`
      INSERT INTO hospitals (name, location, lat, lng, phone, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING *;
    `, [
      normalizeString(req.body.name),
      normalizeString(req.body.location),
      req.body.lat || null,
      req.body.lng || null,
      normalizeString(req.body.phone) || null,
    ]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create hospital failed:', err);
    res.status(500).json({ error: 'Failed to create hospital.' });
  }
});

router.patch('/:id', authMiddleware, requireAdmin, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid hospital ID.' });

  try {
    const result = await query(`
      UPDATE hospitals
      SET name = COALESCE(NULLIF($1, ''), name),
          location = COALESCE(NULLIF($2, ''), location),
          lat = COALESCE($3, lat),
          lng = COALESCE($4, lng),
          phone = COALESCE(NULLIF($5, ''), phone),
          updated_at = NOW()
      WHERE id = $6
      RETURNING *;
    `, [
      normalizeString(req.body.name),
      normalizeString(req.body.location),
      req.body.lat || null,
      req.body.lng || null,
      normalizeString(req.body.phone),
      id,
    ]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Hospital not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update hospital failed:', err);
    res.status(500).json({ error: 'Failed to update hospital.' });
  }
});

router.delete('/:id', authMiddleware, requireAdmin, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid hospital ID.' });

  try {
    const beds = await query('SELECT COUNT(*) AS count FROM beds WHERE hospital_id = $1', [id]);
    if (Number(beds.rows[0].count) > 0) {
      return res.status(400).json({ error: 'Cannot delete a hospital that still has beds.' });
    }
    const result = await query('DELETE FROM hospitals WHERE id = $1', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Hospital not found.' });
    res.json({ message: 'Hospital deleted.' });
  } catch (err) {
    console.error('Delete hospital failed:', err);
    res.status(500).json({ error: 'Failed to delete hospital.' });
  }
});

module.exports = router;

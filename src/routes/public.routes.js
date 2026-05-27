const express = require('express');
const router = express.Router();
const { query } = require('../db');

router.get('/hospitals', async (req, res) => {
  try {
    const sql = `
      SELECT
        h.id,
        h.name,
        h.location,
        h.lat,
        h.lng,
        h.phone,
        h.updated_at AS hospital_updated_at,
        COUNT(b.bed_id) AS total_capacity,
        COUNT(b.bed_id) FILTER (WHERE b.current_status = 'AVAILABLE') AS available_beds,
        MAX(b.updated_at) AS last_bed_update,
        json_agg(
          DISTINCT jsonb_build_object(
            'ward_name', wb.ward_name,
            'specialty_type', wb.specialty_type,
            'available_beds', wb.available_beds,
            'total_beds', wb.total_beds
          )
        ) FILTER (WHERE wb.ward_name IS NOT NULL) AS wards
      FROM hospitals h
      LEFT JOIN beds b ON h.id = b.hospital_id
      LEFT JOIN (
        SELECT
          hospital_id,
          ward_name,
          specialty_type,
          COUNT(bed_id) FILTER (WHERE current_status = 'AVAILABLE') AS available_beds,
          COUNT(bed_id) AS total_beds
        FROM beds
        GROUP BY hospital_id, ward_name, specialty_type
      ) AS wb ON h.id = wb.hospital_id
      GROUP BY h.id
      ORDER BY h.name ASC;
    `;
    const result = await query(sql);
    const hospitals = result.rows.map((h) => ({ ...h, wards: h.wards || [] }));
    res.json(hospitals);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

router.get('/hospitals/:id/availability', async (req, res) => {
  try {
    const { id } = req.params;
    const sql = `
      SELECT
        ward_name,
        specialty_type,
        COUNT(*) AS total_beds,
        COUNT(*) FILTER (WHERE current_status = 'AVAILABLE') AS available_beds,
        MAX(updated_at) AS last_updated
      FROM beds
      WHERE hospital_id = $1
      GROUP BY ward_name, specialty_type
      ORDER BY ward_name ASC;
    `;
    const result = await query(sql, [id]);
    res.json(result.rows);
  } catch (err) {
    console.error('DATABASE ERROR:', err.message);
    res.status(500).send('Server Error');
  }
});

module.exports = router;

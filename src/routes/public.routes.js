const express = require('express');
const router = express.Router();
const { Pool } = require('pg'); // Adjust path if your db export is different
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});


// GET: Summary of all hospitals and their available beds
router.get('/hospitals', async (req, res) => {
    try {
        const query = `
            SELECT
                h.id,
                h.name,
                h.location,
                h.lat,
                h.lng,
                COUNT(b.bed_id) AS total_capacity,
                COUNT(b.bed_id) FILTER (WHERE b.current_status = 'AVAILABLE') AS available_beds,
                json_agg(
                    json_build_object(
                        'ward_name', wb.ward_name,
                        'available_beds', wb.available_beds,
                        'total_beds', wb.total_beds
                    )
                ) FILTER (WHERE wb.ward_name IS NOT NULL) AS wards
            FROM
                hospitals h
            LEFT JOIN
                beds b ON h.id = b.hospital_id
            LEFT JOIN (
                SELECT
                    hospital_id,
                    ward_name,
                    COUNT(bed_id) FILTER (WHERE current_status = 'AVAILABLE') AS available_beds,
                    COUNT(bed_id) as total_beds
                FROM beds
                GROUP BY hospital_id, ward_name
            ) AS wb ON h.id = wb.hospital_id
            GROUP BY
                h.id
            ORDER BY
                h.name ASC;
        `;
        const result = await pool.query(query);
        const hospitals = result.rows.map(h => ({ ...h, wards: h.wards || [] }));
        res.json(hospitals);
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// GET: Specific availability breakdown by ward for one hospital
router.get('/hospitals/:id/availability', async (req, res) => {
    try {
        const { id } = req.params;
        const query = `
            SELECT 
                ward_name, 
                COUNT(*) as total_beds,
                COUNT(*) FILTER (WHERE LOWER(current_status) = 'AVAILABLE') as available_beds
            FROM beds 
            WHERE hospital_id = $1
            GROUP BY ward_name;
        `;
        const result = await pool.query(query, [id]);
        res.json(result.rows);
    } catch (err) {
        console.error("DATABASE ERROR: ",err.message);
        res.status(500).send("Server Error");
    }
});

module.exports = router;
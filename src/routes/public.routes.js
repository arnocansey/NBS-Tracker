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
                COUNT(b.bed_id) FILTER (WHERE b.current_status = 'available') as available_beds
            FROM hospitals h
            LEFT JOIN beds b ON h.id = b.hospital_id
            GROUP BY h.id
            ORDER BY h.name ASC;
        `;
        const result = await pool.query(query);
        res.json(result.rows);
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
                COUNT(*) FILTER (WHERE bed_status = 'available') as available_beds
            FROM beds 
            WHERE hospital_id = $1
            GROUP BY ward_name;
        `;
        const result = await pool.query(query, [id]);
        res.json(result.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

module.exports = router;
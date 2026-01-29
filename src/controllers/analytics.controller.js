// backend/src/controllers/analytics.controller.js
const db = require('../db');

exports.getOccupancyByHospital = async (req, res) => {
    try {
        const query = `
            SELECT
                h.name,
                COALESCE(
                    (
                        100.0 * (COUNT(b.bed_id) - COUNT(b.bed_id) FILTER (WHERE b.current_status = 'AVAILABLE'))
                    ) / NULLIF(COUNT(b.bed_id), 0)
                , 0) AS occupancy_percentage
            FROM
                hospitals h
            LEFT JOIN
                beds b ON h.id = b.hospital_id
            GROUP BY
                h.id
            ORDER BY
                h.name;
        `;
        const { rows } = await db.query(query);
        
        res.json(rows);

    } catch (err) {
        console.error("Analytics controller error:", err.message);
        res.status(500).send("Server Error");
    }
};

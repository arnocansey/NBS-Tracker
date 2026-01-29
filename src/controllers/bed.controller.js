// backend/src/controllers/bed.controller.js
const pool = require('../config/db'); // Ensure this points to your database connection file
const { getIO } = require('../websockets');

const bedController = {
    // 1. Create a New Bed (Called by AddBedForm)
    createBed: async (req, res) => {
        const { ward_name, specialty_type, current_status } = req.body;

        try {
            const query = `
                INSERT INTO beds (ward_name, specialty_type, current_status)
                VALUES ($1, $2, $3)
                RETURNING *;
            `;
            const values = [ward_name, specialty_type, current_status || 'AVAILABLE'];
            const result = await pool.query(query, values);
            
            getIO().emit('beds_updated'); // Emit event
            res.status(201).json(result.rows[0]);
        } catch (err) {
            console.error('Error creating bed:', err);
            res.status(500).json({ error: 'Internal server error while creating bed' });
        }
    },

    // 2. Get All Beds (Called by DashboardPage)
    getAllBeds: async (req, res) => {
        const { specialty_type } = req.query;
        try {
            let query = 'SELECT * FROM beds';
            let values = [];

            if (specialty_type && specialty_type !== 'All') {
                query += ' WHERE specialty_type = $1';
                values.push(specialty_type);
            }

            query += ' ORDER BY bed_id ASC';
            const result = await pool.query(query, values);
            res.json(result.rows);
        } catch (err) {
            console.error('Error fetching beds:', err);
            res.status(500).json({ error: 'Internal server error while fetching beds' });
        }
    },

    // 3. Update Bed Status (Called by BedCard for Discharge/Cleaning)
    updateBedStatus: async (req, res) => {
        const { id } = req.params;
        const { new_status } = req.body;

        try {
            const query = `
                UPDATE beds 
                SET current_status = $1 
                WHERE bed_id = $2 
                RETURNING *;
            `;
            const result = await pool.query(query, [new_status, id]);

            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Bed not found' });
            }

            getIO().emit('beds_updated'); // Emit event
            res.json(result.rows[0]);
        } catch (err) {
            console.error('Error updating status:', err);
            res.status(500).json({ error: 'Internal server error while updating status' });
        }
    },

    // 4. Delete Bed
    deleteBed: async (req, res) => {
        const { id } = req.params;
        try {
            await pool.query('DELETE FROM beds WHERE bed_id = $1', [id]);
            getIO().emit('beds_updated'); // Emit event
            res.json({ message: 'Bed deleted successfully' });
        } catch (err) {
            console.error('Error deleting bed:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
};

module.exports = bedController;
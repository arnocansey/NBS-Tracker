// backend/src/routes/transfer.routes.js

const express = require('express');
const router = express.Router();
const { query } = require('../db');
const authMiddleware = require('../middleware/auth.middleware');

// =======================================================
// Function 4: POST /api/v1/transfers (Create Request)
// =======================================================
router.post('/', authMiddleware, async (req, res) => {
    const { patient_name, from_ward, required_specialty, priority, clinical_notes } = req.body;

    const sql = `
        INSERT INTO transfer_requests 
        (patient_name, from_ward, required_specialty, priority, clinical_notes) 
        VALUES ($1, $2, $3, $4, $5) 
        RETURNING *;
    `;

    try {
        const result = await query(sql, [patient_name, from_ward, required_specialty, priority, clinical_notes]);
        res.status(201).json({ message: 'Transfer request created.', request: result.rows[0] });
    } catch (err) {
        console.error('Error creating transfer:', err);
        res.status(500).json({ error: 'Failed to create transfer request.' });
    }
});

// =======================================================
// Function 5: GET /api/v1/transfers (List Requests)
// =======================================================
router.get('/', authMiddleware, async (req, res) => {
    const { status } = req.query; // Optional filter: e.g., ?status=PENDING

    const sql = `
        SELECT * FROM transfer_requests 
        WHERE status = $1 OR $1 IS NULL 
        ORDER BY 
            CASE 
                WHEN priority = 'Emergency' THEN 1
                WHEN priority = 'High' THEN 2
                WHEN priority = 'Medium' THEN 3
                ELSE 4 
            END ASC, 
            created_at DESC;
    `;

    try {
        const result = await query(sql, [status]);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching transfers:', err);
        res.status(500).json({ error: 'Failed to fetch transfer requests.' });
    }
});

// =======================================================
// Function 6: PATCH /api/v1/transfers/:id (Approve/Reject)
// =======================================================
router.patch('/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const { new_status, assigned_bed_id } = req.body; 

    try {
        // START TRANSACTION: We want both the request update and bed update to happen together
        await query('BEGIN');

        // 1. Update the Transfer Request Status
        const updateRequestSql = `
            UPDATE transfer_requests 
            SET status = $1 
            WHERE request_id = $2 
            RETURNING *;
        `;
        const requestResult = await query(updateRequestSql, [new_status, id]);

        if (requestResult.rowCount === 0) {
            await query('ROLLBACK');
            return res.status(404).json({ error: 'Request not found.' });
        }

        // 2. AUTOMATION: If approved and a bed is assigned, mark that bed as OCCUPIED
        if (new_status === 'APPROVED' && assigned_bed_id) {
            const updateBedSql = `
                UPDATE beds 
                SET current_status = 'OCCUPIED', last_updated_at = NOW() 
                WHERE bed_id = $1;
            `;
            await query(updateBedSql, [assigned_bed_id]);
        }

        await query('COMMIT'); // Save changes
        
        res.json({ 
            message: `Transfer ${new_status}`, 
            request: requestResult.rows[0],
            automation: new_status === 'APPROVED' ? 'Target bed marked as OCCUPIED' : 'None'
        });

    } catch (err) {
        await query('ROLLBACK'); // Undo everything if there is an error
        console.error('Transaction Error:', err);
        res.status(500).json({ error: 'Failed to process approval automation.' });
    }
});

module.exports = router;
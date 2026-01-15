const express = require('express');
const router = express.Router();
const { query } = require('../db'); // Consistently use your db helper
const authMiddleware = require('../middleware/auth.middleware');

// 1. GET ALL BEDS (With Join for Patient Names)
router.get('/', async (req, res) => {
    const { specialty_type } = req.query; 

    const sql = `
        SELECT 
            b.bed_id, 
            b.ward_name, 
            b.specialty_type, 
            b.current_status,
            a.patient_name
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

// 2. CREATE NEW BED (Admin only)
router.post('/', authMiddleware, async (req, res) => {
    const { ward_name, specialty_type, current_status } = req.body;
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Forbidden' });

    const sql = 'INSERT INTO beds (ward_name, specialty_type, current_status) VALUES ($1, $2, $3) RETURNING *';
    try {
        const result = await query(sql, [ward_name, specialty_type, current_status || 'AVAILABLE']);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Failed to create bed.' });
    }
});

// 3. UPDATE BED STATUS & ADMISSIONS (The "Truth" for Patient Names)
router.post('/:bedId/status', authMiddleware, async (req, res) => {
    const { bedId } = req.params;
    const { new_status, patient_name } = req.body;

    try {
        // Start Transaction
        await query('BEGIN');

        // Update Bed Status
        await query('UPDATE beds SET current_status = $1 WHERE bed_id = $2', [new_status, bedId]);

        if (new_status === 'OCCUPIED' && patient_name) {
            // New Admission
            await query(
                'INSERT INTO admissions (patient_name, bed_id, admitted_at) VALUES ($1, $2, NOW())',
                [patient_name, bedId]
            );
        } else if (new_status === 'CLEANING' || new_status === 'AVAILABLE') {
            // Close existing admission
            await query(
                'UPDATE admissions SET discharged_at = NOW() WHERE bed_id = $1 AND discharged_at IS NULL',
                [bedId]
            );
        }

        await query('COMMIT');
        res.json({ message: 'Status updated successfully' });
    } catch (err) {
        await query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: 'Database transaction failed' });
    }
});

// 4. TRANSFER PATIENT (Integrated with Admissions Table)
router.post('/transfer', authMiddleware, async (req, res) => {
    const { sourceBedId, targetBedId, patientName } = req.body;

    if (!sourceBedId || !targetBedId) {
        return res.status(400).json({ error: "Source and Target Bed IDs required." });
    }

    try {
        await query('BEGIN');

        // 1. Close admission at Source Bed
        await query(
            'UPDATE admissions SET discharged_at = NOW() WHERE bed_id = $1 AND discharged_at IS NULL',
            [parseInt(sourceBedId)]
        );
        await query('UPDATE beds SET current_status = \'CLEANING\' WHERE bed_id = $1', [parseInt(sourceBedId)]);

        // 2. Open admission at Target Bed
        await query(
            'INSERT INTO admissions (patient_name, bed_id, admitted_at) VALUES ($1, $2, NOW())',
            [patientName, parseInt(targetBedId)]
        );
        await query('UPDATE beds SET current_status = \'OCCUPIED\' WHERE bed_id = $1', [parseInt(targetBedId)]);

        await query('COMMIT');
        res.json({ success: true, message: "Patient transferred successfully" });
    } catch (err) {
        await query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: "Transfer transaction failed" });
    }
});

module.exports = router;
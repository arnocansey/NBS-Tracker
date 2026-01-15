// backend/src/routes/auth.routes.js

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs'); // 1. Import bcrypt
const authMiddleware = require('../middleware/auth.middleware');
const { query } = require('../db'); 

const JWT_SECRET = 'YOUR_SUPER_SECURE_JWT_SECRET_KEY'; 

// =======================================================
// Function: POST /api/v1/auth/signup (NEW)
// =======================================================
router.post('/signup', async (req, res) => {
    const { username, password, role } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required.' });
    }

    try {
        // 1. Check if username already exists
        const checkUser = await query('SELECT username FROM users WHERE username = $1', [username]);
        if (checkUser.rows.length > 0) {
            return res.status(400).json({ error: 'Username is already taken.' });
        }

        // 2. Hash the password for security
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // 3. Insert into database
        const sql = `
            INSERT INTO users (username, password_hash, user_role) 
            VALUES ($1, $2, $3) 
            RETURNING user_id, username, user_role;
        `;
        const result = await query(sql, [username, hashedPassword, role ? role.toUpperCase() : 'STAFF']);

        res.status(201).json({ 
            message: 'User registered successfully', 
            user: result.rows[0] 
        });

    } catch (err) {
        console.error('Signup error:', err);
        res.status(500).json({ error: 'Failed to create account.' });
    }
});

// =======================================================
// Function: POST /api/v1/auth/login (Updated with bcrypt)
// =======================================================
router.post('/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required.' });
    }

    try {
        const sql = `SELECT user_id, username, password_hash, user_role FROM users WHERE username = $1;`;
        const result = await query(sql, [username]);

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid username or password.' });
        }

        const user = result.rows[0];
        // 4. Verify password using bcrypt
        const isMatch = await bcrypt.compare(password, user.password_hash);

        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid username or password.' });
        }

        const token = jwt.sign(
            { user_id: user.user_id, role: user.user_role },
            JWT_SECRET,
            { expiresIn: '1h' }
        );

        res.json({
            message: 'Login successful',
            token: token,
            user: { username: user.username, role: user.user_role }
        });

    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Server error during authentication.' });
    }
});

router.post('/admin-reset-password', authMiddleware, async (req, res) => {
    const { targetUsername, newPassword } = req.body;
    const adminRole = req.user.role; // Extract from JWT via middleware

    // 1. Security Check: Only Admins can do this
    if (adminRole !== 'ADMIN') {
        return res.status(403).json({ error: "Access denied. Admin only." });
    }

    try {
        // 2. Hash the new password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        // 3. Update the database
        const sql = `UPDATE users SET password_hash = $1 WHERE username = $2`;
        const result = await query(sql, [hashedPassword, targetUsername]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: "User not found." });
        }

        res.json({ message: `Password for ${targetUsername} has been reset.` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error during password reset." });
    }
});

module.exports = router;
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const authMiddleware = require('../middleware/auth.middleware');
const { query } = require('../db');
const config = require('../config/app.config');
const { ROLES, normalizeString } = require('../utils/validation');

const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Access denied. Admin only.' });
  }
  return next();
};

router.post('/signup', async (req, res) => {
  const username = normalizeString(req.body.username);
  const password = normalizeString(req.body.password);
  const requestedRole = normalizeString(req.body.role).toUpperCase();

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
  }

  const role = config.allowAdminSignup && ROLES.has(requestedRole) ? requestedRole : 'STAFF';

  try {
    const checkUser = await query('SELECT username FROM users WHERE username = $1', [username]);
    if (checkUser.rows.length > 0) {
      return res.status(400).json({ error: 'Username is already taken.' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const sql = `
      INSERT INTO users (username, password_hash, user_role)
      VALUES ($1, $2, $3)
      RETURNING user_id, username, user_role;
    `;
    const result = await query(sql, [username, hashedPassword, role]);

    res.status(201).json({
      message: 'User registered successfully',
      user: result.rows[0],
    });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Failed to create account.' });
  }
});

router.post('/login', async (req, res) => {
  const username = normalizeString(req.body.username);
  const password = normalizeString(req.body.password);

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  try {
    const sql = 'SELECT user_id, username, password_hash, user_role FROM users WHERE username = $1;';
    const result = await query(sql, [username]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const token = jwt.sign(
      { user_id: user.user_id, role: user.user_role, username: user.username },
      config.jwtSecret,
      { expiresIn: process.env.JWT_EXPIRES_IN || '1h' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: { username: user.username, role: user.user_role },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error during authentication.' });
  }
});

router.get('/users', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const result = await query(`
      SELECT user_id, username, user_role
      FROM users
      ORDER BY username ASC;
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('User list error:', err);
    res.status(500).json({ error: 'Failed to load users.' });
  }
});

router.patch('/users/:username/role', authMiddleware, requireAdmin, async (req, res) => {
  const username = normalizeString(req.params.username);
  const role = normalizeString(req.body.role).toUpperCase();

  if (!ROLES.has(role)) {
    return res.status(400).json({ error: 'Invalid role.' });
  }

  try {
    const result = await query(
      'UPDATE users SET user_role = $1 WHERE username = $2 RETURNING user_id, username, user_role',
      [role, username]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'User not found.' });
    res.json({ message: 'Role updated.', user: result.rows[0] });
  } catch (err) {
    console.error('Role update error:', err);
    res.status(500).json({ error: 'Failed to update role.' });
  }
});

router.post('/password-reset-requests', async (req, res) => {
  const username = normalizeString(req.body.username);
  if (!username) return res.status(400).json({ error: 'Username is required.' });

  try {
    await query(`
      INSERT INTO password_reset_requests (username, status, requested_at)
      VALUES ($1, 'PENDING', NOW())
    `, [username]);
  } catch (err) {
    console.warn('Password reset request could not be persisted:', err.message);
  }

  res.status(202).json({
    message: 'If the account exists, a password reset request has been recorded for an administrator.',
  });
});

router.post('/admin-reset-password', authMiddleware, requireAdmin, async (req, res) => {
  const targetUsername = normalizeString(req.body.targetUsername);
  const newPassword = normalizeString(req.body.newPassword);

  if (!targetUsername || !newPassword) {
    return res.status(400).json({ error: 'Target username and new password are required.' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
  }

  try {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    const result = await query('UPDATE users SET password_hash = $1 WHERE username = $2', [hashedPassword, targetUsername]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    res.json({ message: `Password for ${targetUsername} has been reset.` });
  } catch (err) {
    console.error('Password reset error:', err);
    res.status(500).json({ error: 'Server error during password reset.' });
  }
});

module.exports = router;

// server.js

const express = require('express');
const cors = require('cors'); 
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const bedsRouter = require('./routes/beds.routes');
const authRouter = require('./routes/auth.routes');
const transferRouter = require('./routes/transfer.routes');

const app = express();
const PORT = 3000;

// --- 1. Middleware ---
app.use(cors()); 
app.use(express.json()); 

// --- 2. API Routes ---
// These must come BEFORE the static file serving
app.use('/api/v1/transfers', transferRouter);
app.use('/api/v1/beds', bedsRouter);
app.use('/api/v1/auth', authRouter);

// --- 3. Static Files ---
// Tell Express where your React build lives
app.use(express.static(path.join(__dirname, '../frontend/dist')));

// --- 4. The Catch-All ---
// REMOVE the app.get('/') text response. 
// This named wildcard handles the root (/) AND refreshes (/dashboard)
// Catch-all middleware: serve frontend index for non-API requests
app.use((req, res, next) => {
    // Skip API routes
    if (req.path && req.path.startsWith('/api/')) return next();

    const indexPath = path.join(__dirname, '../frontend/dist/index.html');
    if (require('fs').existsSync(indexPath)) {
        return res.sendFile(indexPath);
    }

    // If frontend build missing, continue to next middleware (or 404)
    next();
});

// --- Start Server ---
app.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
    console.log('✅ API and Frontend ready for Command Center operations.');
});
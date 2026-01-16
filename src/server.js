const express = require('express');
const cors = require('cors'); 
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
require('dotenv').config();

// Initialize DB Pool
const pool = new Pool({ 
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Required for most cloud DBs like Render/Neon
});

const bedsRouter = require('./routes/beds.routes');
const authRouter = require('./routes/auth.routes');
const transferRouter = require('./routes/transfer.routes');

const app = express();

// Use dynamic port for Render deployment
const PORT = process.env.PORT || 3000;

// --- 1. Middleware ---
app.use(cors({
    // Replace with your Vercel URL after deployment for extra security
    origin: '*', 
    methods: ['GET', 'POST', 'PATCH', 'DELETE']
})); 
app.use(express.json()); 

// --- 2. Health Check (Requested) ---
// Use this to verify DB connection without loading the whole UI
app.get('/api/v1/health', async (req, res) => {
    try {
        const dbCheck = await pool.query('SELECT NOW()');
        res.status(200).json({
            status: 'UP',
            database: 'CONNECTED',
            server_time: dbCheck.rows[0].now,
            environment: process.env.NODE_ENV || 'development'
        });
    } catch (err) {
        res.status(500).json({ 
            status: 'DOWN', 
            database: 'CONNECTION_ERROR', 
            error: err.message 
        });
    }
});

// --- 3. API Routes ---
app.use('/api/v1/transfers', transferRouter);
app.use('/api/v1/beds', bedsRouter);
app.use('/api/v1/auth', authRouter);

// --- 4. Static Files & SPA Routing ---
// Serve the built React files from the dist folder
const frontendBuildPath = path.join(__dirname, '../frontend/dist');
app.use(express.static(frontendBuildPath));

// Catch-all: If a route doesn't match an API or static file, serve index.html
// Use a middleware (not a route with '*') to avoid path-to-regexp parsing issues
app.use((req, res, next) => {
    // Only handle GET requests that are not API calls
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();

    const indexFile = path.join(frontendBuildPath, 'index.html');
    if (!fs.existsSync(indexFile)) return next();

    res.sendFile(indexFile, (err) => {
        if (err) {
            console.error('Error sending index.html', err);
            res.status(500).send("Frontend build not found or failed to serve. Ensure you built the frontend.");
        }
    });
});

// --- Start Server ---
app.listen(PORT, () => {
    console.log(`🚀 NBS Tracker Server running on port ${PORT}`);
    console.log(`🏥 Health Check: http://localhost:${PORT}/api/v1/health`);
});
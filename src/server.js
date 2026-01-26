const express = require('express');
const cors = require('cors'); 
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
const publicRoutes = require('./routes/public.routes');

const app = express();

// Use dynamic port for Render deployment
const PORT = process.env.PORT || 3000;

// --- 1. Middleware ---
app.use(cors({
  // Use a wildcard temporarily to prove it's a CORS issue
  origin: '*', 
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS' , 'PUT'],
  allowedHeaders: ['Content-Type', 'Authorization']
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
app.use('/api/v1/public', publicRoutes);
app.use('/api/v1/transfers', transferRouter);
app.use('/api/v1/beds', bedsRouter);
app.use('/api/v1/auth', authRouter);

// --- Start Server ---
app.listen(PORT, () => {
    console.log(`🚀 NBS Tracker Server running on port ${PORT}`);
    console.log(`🏥 Health Check: http://localhost:${PORT}/api/v1/health`);
});
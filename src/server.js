const express = require('express');
const cors = require('cors');
const http = require('http');
const { init: initWebSockets } = require('./websockets');
const { query } = require('./db');
const config = require('./config/app.config');
require('dotenv').config();

const bedsRouter = require('./routes/beds.routes');
const authRouter = require('./routes/auth.routes');
const transferRouter = require('./routes/transfer.routes');
const publicRoutes = require('./routes/public.routes');
const analyticsRouter = require('./routes/analytics.routes');
const hospitalsRouter = require('./routes/hospitals.routes');

const app = express();
const server = http.createServer(app);

initWebSockets(server);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS', 'PUT'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

app.get('/api/v1/health', async (req, res) => {
  try {
    const dbCheck = await query('SELECT NOW()');
    res.status(200).json({
      status: 'UP',
      database: 'CONNECTED',
      server_time: dbCheck.rows[0].now,
      environment: process.env.NODE_ENV || 'development',
    });
  } catch (err) {
    res.status(500).json({
      status: 'DOWN',
      database: 'CONNECTION_ERROR',
      error: err.message,
    });
  }
});

app.use('/api/v1/public', publicRoutes);
app.use('/api/v1/transfers', transferRouter);
app.use('/api/v1/beds', bedsRouter);
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/analytics', analyticsRouter);
app.use('/api/v1/hospitals', hospitalsRouter);

server.listen(config.port, () => {
  console.log(`NBS Tracker Server running on port ${config.port}`);
  console.log(`Health Check: http://localhost:${config.port}/api/v1/health`);
});

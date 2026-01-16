const { Pool } = require('pg');
require('dotenv').config();

// Use connectionString because it's the easiest way to connect to Neon
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // REQUIRED for Neon/Render cloud connections
  }
});

const query = (text, params) => pool.query(text, params);

console.log('Database pool initialized using cloud configuration.');

module.exports = {
  query,
};
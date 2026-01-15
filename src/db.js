// db.js

const { Pool } = require('pg');

// Replace with your actual database credentials
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'no_bed_syndrome_db',
  password: '    ',
  port: 5432, 
});

// A simple function to execute queries
const query = (text, params) => pool.query(text, params);

console.log('Database pool initialized.');

module.exports = {
  query,
};
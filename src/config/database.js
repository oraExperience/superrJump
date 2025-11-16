
// Only load dotenv in local development, not in Vercel
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const { Pool } = require('pg');

// Supabase PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

module.exports = pool;

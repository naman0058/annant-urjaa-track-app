'use strict';

require('dotenv').config();
const MySQL = require('mysql2/promise');
const { processDueScheduledPosts } = require('../services/blogScheduledPublishService');

async function main() {
  const pool = MySQL.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME || 'itorus',
    waitForConnections: true,
    connectionLimit: 2,
    namedPlaceholders: true,
  });
  try {
    const result = await processDueScheduledPosts(pool, { limit: 50 });
    console.log(`Scheduled publish: checked ${result.checked}, published ${result.published}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
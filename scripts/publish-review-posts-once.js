'use strict';

require('dotenv').config();
const MySQL = require('mysql2/promise');
const blogRepository = require('../services/blogRepository');

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
    const [rows] = await pool.query(
      `SELECT id, title FROM blog_posts WHERE status = 'review' AND deleted_at IS NULL ORDER BY id`
    );
    let published = 0;
    for (const row of rows) {
      if (await blogRepository.publishPost(pool, row.id)) published += 1;
    }
    try {
      require('../services/blogPublicService').bustPublicCache();
    } catch {
      /* optional */
    }
    console.log(`Review posts: ${rows.length}, published: ${published}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
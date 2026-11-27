'use strict';

/** Idempotent: adds idx_blog_published_id if missing. */
require('dotenv').config();
const mysql = require('mysql2/promise');

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
  });
  try {
    const [rows] = await conn.query(
      `SHOW INDEX FROM blog_posts WHERE Key_name = 'idx_blog_published_id'`
    );
    if (rows.length) {
      console.log('idx_blog_published_id already exists.');
      return;
    }
    await conn.query(
      'CREATE INDEX idx_blog_published_id ON blog_posts (published_at, id)'
    );
    console.log('Created idx_blog_published_id.');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
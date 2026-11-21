'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'migrations', '005_admin_platform.sql'), 'utf8');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    multipleStatements: true,
  });
  await conn.query(sql);
  const [cols] = await conn.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admins' AND COLUMN_NAME = 'is_active'`
  );
  if (!cols.length) {
    await conn.query(`ALTER TABLE admins ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER role`);
  }
  await conn.end();
  console.log('migrate-admin-platform: OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
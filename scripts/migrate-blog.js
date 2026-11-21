'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const migrations = [
  path.join(root, 'sql', 'migrations', '001_blog_cms.sql'),
  path.join(root, 'sql', 'migrations', '002_blog_cms_normalized.sql'),
  path.join(root, 'sql', 'migrations', '003_blog_ai_job_types.sql'),
  path.join(root, 'sql', 'migrations', '004_blog_folder_import.sql'),
];

async function runSqlFile(connection, filePath) {
  const sql = fs.readFileSync(filePath, 'utf8');
  console.log('Applying', path.basename(filePath));
  await connection.query(sql);
}

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    multipleStatements: true,
  });

  try {
    for (const file of migrations) {
      if (fs.existsSync(file)) await runSqlFile(connection, file);
    }
    console.log('SQL migrations complete.');
  } finally {
    await connection.end();
  }

  const alter = spawnSync(process.execPath, [path.join(__dirname, 'migrate-blog-alter.js')], {
    stdio: 'inherit',
    env: process.env,
  });
  if (alter.status !== 0) process.exit(alter.status || 1);

  const importAlter = spawnSync(process.execPath, [path.join(__dirname, 'migrate-blog-import-alter.js')], {
    stdio: 'inherit',
    env: process.env,
  });
  if (importAlter.status !== 0) process.exit(importAlter.status || 1);

  console.log('All blog migrations applied successfully.');
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
'use strict';

/**
 * Cron-compatible worker: processes one batch of folder import items.
 * Example: node scripts/process-blog-import-jobs.js
 *          node scripts/process-blog-import-jobs.js --job=12 --limit=3
 *
 * Does NOT run on application start.
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const { processImportBatch } = require('../services/import/folderImportProcessor');

function parseArgs() {
  const out = { jobId: null, limit: null };
  for (const raw of process.argv.slice(2)) {
    if (raw.startsWith('--job=')) out.jobId = parseInt(raw.split('=')[1], 10);
    if (raw.startsWith('--limit=')) out.limit = parseInt(raw.split('=')[1], 10);
  }
  return out;
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY not set; skipping.');
    process.exit(0);
  }

  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 3,
    namedPlaceholders: true,
  });

  const { jobId, limit } = parseArgs();
  try {
    const result = await processImportBatch(pool, { jobId, limit });
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
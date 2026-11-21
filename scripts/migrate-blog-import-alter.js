'use strict';

/**
 * Idempotent ALTERs for blog folder import jobs (safe re-run).
 */

require('dotenv').config();
const mysql = require('mysql2/promise');

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows[0].c > 0;
}

async function addColumn(conn, table, column, ddl) {
  if (await columnExists(conn, table, column)) return;
  await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN ${ddl}`);
  console.log(`  + column ${table}.${column}`);
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    multipleStatements: true,
  });

  try {
    const [jobsTable] = await conn.query(
      `SELECT COUNT(*) AS c FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'blog_import_jobs'`
    );
    if (!jobsTable[0].c) {
      console.log('blog_import_jobs not found — run 002 migration first.');
      return;
    }

    console.log('Altering blog import tables (idempotent)...');

    try {
      await conn.query(
        `ALTER TABLE blog_import_jobs MODIFY COLUMN status VARCHAR(32) NOT NULL DEFAULT 'pending'`
      );
    } catch (e) {
      console.warn('  status widen jobs:', e.message);
    }

    try {
      await conn.query(
        `ALTER TABLE blog_import_items MODIFY COLUMN status VARCHAR(32) NOT NULL DEFAULT 'pending'`
      );
    } catch (e) {
      console.warn('  status widen items:', e.message);
    }

    await addColumn(
      conn,
      'blog_import_jobs',
      'heartbeat_at',
      '`heartbeat_at` DATETIME NULL AFTER `completed_at`'
    );
    await addColumn(
      conn,
      'blog_import_jobs',
      'worker_lock',
      '`worker_lock` VARCHAR(64) NULL AFTER `heartbeat_at`'
    );
    await addColumn(
      conn,
      'blog_import_jobs',
      'estimated_cost_usd',
      '`estimated_cost_usd` DECIMAL(12,6) NULL AFTER `actual_tokens`'
    );
    await addColumn(
      conn,
      'blog_import_jobs',
      'actual_cost_usd',
      '`actual_cost_usd` DECIMAL(12,6) NULL AFTER `estimated_cost_usd`'
    );
    await addColumn(
      conn,
      'blog_import_jobs',
      'error_summary',
      '`error_summary` TEXT NULL AFTER `actual_cost_usd`'
    );
    await addColumn(
      conn,
      'blog_import_jobs',
      'client_request_id',
      '`client_request_id` VARCHAR(64) NULL AFTER `job_key`'
    );
    await addColumn(
      conn,
      'blog_import_jobs',
      'import_post_id',
      '`import_post_id` INT NULL COMMENT "legacy" AFTER `error_summary`'
    );

    await addColumn(
      conn,
      'blog_import_items',
      'relative_path',
      '`relative_path` VARCHAR(500) NULL AFTER `file_name`'
    );
    await addColumn(
      conn,
      'blog_import_items',
      'file_size_bytes',
      '`file_size_bytes` INT UNSIGNED NULL AFTER `relative_path`'
    );
    await addColumn(
      conn,
      'blog_import_items',
      'skip_reason',
      '`skip_reason` VARCHAR(500) NULL AFTER `error_message`'
    );
    await addColumn(
      conn,
      'blog_import_items',
      'tokens_input',
      '`tokens_input` INT UNSIGNED NULL AFTER `skip_reason`'
    );
    await addColumn(
      conn,
      'blog_import_items',
      'tokens_output',
      '`tokens_output` INT UNSIGNED NULL AFTER `tokens_input`'
    );
    await addColumn(
      conn,
      'blog_import_items',
      'result_json',
      '`result_json` JSON NULL AFTER `tokens_output`'
    );

    console.log('blog import alter complete.');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('Import alter failed:', err.message);
  process.exit(1);
});
'use strict';

/**
 * Idempotent ALTERs for blog_posts (safe re-run).
 * Renames legacy columns when present; adds normalized columns + indexes.
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

async function indexExists(conn, table, indexName) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, indexName]
  );
  return rows[0].c > 0;
}

async function addColumn(conn, table, column, ddl) {
  if (await columnExists(conn, table, column)) return;
  await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN ${ddl}`);
  console.log(`  + column ${table}.${column}`);
}

async function renameColumn(conn, table, from, to, definition) {
  if (!(await columnExists(conn, table, from))) return;
  if (await columnExists(conn, table, to)) return;
  await conn.query(`ALTER TABLE \`${table}\` CHANGE COLUMN \`${from}\` \`${to}\` ${definition}`);
  console.log(`  ~ rename ${table}.${from} -> ${to}`);
}

async function addIndex(conn, table, indexName, ddl) {
  if (await indexExists(conn, table, indexName)) return;
  await conn.query(`ALTER TABLE \`${table}\` ADD ${ddl}`);
  console.log(`  + index ${table}.${indexName}`);
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
    const [tables] = await conn.query(
      `SELECT COUNT(*) AS c FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'blog_posts'`
    );
    if (!tables[0].c) {
      console.log('blog_posts not found — run 001 migration first.');
      return;
    }

    console.log('Altering blog_posts (idempotent)...');

    await renameColumn(conn, 'blog_posts', 'robots', 'robots_directive', "VARCHAR(80) NOT NULL DEFAULT 'index,follow'");
    await renameColumn(conn, 'blog_posts', 'source_content_hash', 'source_hash', 'CHAR(64) NULL');
    await renameColumn(conn, 'blog_posts', 'ai_rewritten', 'ai_generated', 'TINYINT(1) NOT NULL DEFAULT 0');

    await addColumn(conn, 'blog_posts', 'subtitle', '`subtitle` VARCHAR(500) NULL AFTER `title`');
    await addColumn(conn, 'blog_posts', 'content_json', '`content_json` JSON NULL AFTER `content_html`');
    await addColumn(conn, 'blog_posts', 'meta_abstract', '`meta_abstract` VARCHAR(500) NULL AFTER `meta_keywords`');
    await addColumn(conn, 'blog_posts', 'focus_keyword', '`focus_keyword` VARCHAR(120) NULL AFTER `meta_abstract`');
    await addColumn(conn, 'blog_posts', 'secondary_keywords', '`secondary_keywords` VARCHAR(500) NULL AFTER `focus_keyword`');
    await addColumn(
      conn,
      'blog_posts',
      'search_intent',
      "`search_intent` ENUM('informational','commercial','transactional','navigational','mixed') NULL AFTER `secondary_keywords`"
    );
    await addColumn(conn, 'blog_posts', 'og_image', '`og_image` VARCHAR(500) NULL AFTER `og_description`');
    await addColumn(conn, 'blog_posts', 'twitter_title', '`twitter_title` VARCHAR(100) NULL AFTER `og_image`');
    await addColumn(conn, 'blog_posts', 'twitter_description', '`twitter_description` VARCHAR(320) NULL AFTER `twitter_title`');
    await addColumn(conn, 'blog_posts', 'featured_image_alt', '`featured_image_alt` VARCHAR(255) NULL AFTER `featured_image`');
    await addColumn(
      conn,
      'blog_posts',
      'featured_image_variants',
      '`featured_image_variants` JSON NULL AFTER `featured_image_alt`'
    );
    await addColumn(conn, 'blog_posts', 'author_name', '`author_name` VARCHAR(120) NULL AFTER `author_admin_id`');
    await addColumn(conn, 'blog_posts', 'category_id', '`category_id` INT UNSIGNED NULL AFTER `author_name`');
    await addColumn(conn, 'blog_posts', 'is_featured', '`is_featured` TINYINT(1) NOT NULL DEFAULT 0 AFTER `status`');
    await addColumn(conn, 'blog_posts', 'allow_indexing', '`allow_indexing` TINYINT(1) NOT NULL DEFAULT 1 AFTER `is_featured`');
    await addColumn(conn, 'blog_posts', 'estimated_reading_time', '`estimated_reading_time` SMALLINT UNSIGNED NULL AFTER `allow_indexing`');
    await addColumn(conn, 'blog_posts', 'word_count', '`word_count` INT UNSIGNED NULL AFTER `estimated_reading_time`');
    await addColumn(conn, 'blog_posts', 'seo_score', '`seo_score` TINYINT UNSIGNED NULL AFTER `word_count`');
    await addColumn(conn, 'blog_posts', 'seo_warnings', '`seo_warnings` JSON NULL AFTER `seo_score`');
    await addColumn(
      conn,
      'blog_posts',
      'source_type',
      "`source_type` ENUM('manual','csv','import','api','ai') NOT NULL DEFAULT 'manual' AFTER `seo_warnings`"
    );
    await addColumn(conn, 'blog_posts', 'source_file', '`source_file` VARCHAR(500) NULL AFTER `source_type`');
    await addColumn(
      conn,
      'blog_posts',
      'ai_review_status',
      "`ai_review_status` ENUM('none','pending','approved','rejected') NOT NULL DEFAULT 'none' AFTER `ai_model`"
    );
    await addColumn(conn, 'blog_posts', 'deleted_at', '`deleted_at` DATETIME NULL AFTER `updated_at`');

    if (!(await columnExists(conn, 'blog_posts', 'robots_directive')) && !(await columnExists(conn, 'blog_posts', 'robots'))) {
      await addColumn(
        conn,
        'blog_posts',
        'robots_directive',
        "`robots_directive` VARCHAR(80) NOT NULL DEFAULT 'index,follow'"
      );
    }

    if (!(await columnExists(conn, 'blog_posts', 'source_hash')) && !(await columnExists(conn, 'blog_posts', 'source_content_hash'))) {
      await addColumn(conn, 'blog_posts', 'source_hash', '`source_hash` CHAR(64) NULL');
    }

    if (await columnExists(conn, 'blog_posts', 'source_content_hash') && await columnExists(conn, 'blog_posts', 'source_hash')) {
      await conn.query(
        `UPDATE blog_posts SET source_hash = source_content_hash
         WHERE source_hash IS NULL AND source_content_hash IS NOT NULL`
      );
    }

    if (!(await columnExists(conn, 'blog_posts', 'ai_generated')) && !(await columnExists(conn, 'blog_posts', 'ai_rewritten'))) {
      await addColumn(conn, 'blog_posts', 'ai_generated', '`ai_generated` TINYINT(1) NOT NULL DEFAULT 0');
    }

    // FK category (only if blog_categories exists)
    const [catTable] = await conn.query(
      `SELECT COUNT(*) AS c FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'blog_categories'`
    );
    if (catTable[0].c && !(await indexExists(conn, 'blog_posts', 'fk_blog_post_category'))) {
      try {
        await conn.query(`
          ALTER TABLE blog_posts
          ADD CONSTRAINT fk_blog_post_category
          FOREIGN KEY (category_id) REFERENCES blog_categories(id) ON DELETE SET NULL
        `);
        console.log('  + FK fk_blog_post_category');
      } catch (e) {
        if (!String(e.message).includes('Duplicate')) console.warn('  FK category:', e.message);
      }
    }

    await addIndex(conn, 'blog_posts', 'idx_blog_list_public', 'INDEX idx_blog_list_public (status, allow_indexing, published_at, deleted_at)');
    await addIndex(conn, 'blog_posts', 'idx_blog_category', 'INDEX idx_blog_category (category_id, status)');
    await addIndex(conn, 'blog_posts', 'idx_blog_featured', 'INDEX idx_blog_featured (is_featured, status, published_at)');
    await addIndex(conn, 'blog_posts', 'idx_blog_scheduled', 'INDEX idx_blog_scheduled (status, scheduled_at)');
    await addIndex(conn, 'blog_posts', 'idx_blog_deleted', 'INDEX idx_blog_deleted (deleted_at)');
    await addIndex(conn, 'blog_posts', 'idx_blog_updated', 'INDEX idx_blog_updated (updated_at)');
    await addIndex(conn, 'blog_posts', 'idx_blog_source_hash', 'INDEX idx_blog_source_hash (source_hash)');

    // Legacy unique index name from 001
    if (await indexExists(conn, 'blog_posts', 'uq_blog_source_hash')) {
      // keep for compatibility; source_hash column rename preserves index on column in MySQL
    }

    console.log('blog_posts alter complete.');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('Alter migration failed:', err.message);
  process.exit(1);
});
'use strict';

/**
 * Dev verification: schema presence + transactional CRUD smoke test.
 * Does not print secrets. Rolls back test rows.
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const crypto = require('crypto');

const REQUIRED_TABLES = [
  'blog_posts',
  'blog_categories',
  'blog_tags',
  'blog_post_tags',
  'blog_import_jobs',
  'blog_import_items',
  'blog_revisions',
  'blog_redirects',
  'blog_audit_logs',
  'blog_import_batches',
  'blog_ai_jobs',
];

const REQUIRED_POST_COLUMNS = [
  'title', 'slug', 'subtitle', 'excerpt', 'content_html', 'meta_title', 'meta_description',
  'meta_keywords', 'meta_abstract', 'focus_keyword', 'secondary_keywords', 'search_intent',
  'canonical_url', 'robots_directive', 'og_title', 'og_description', 'og_image',
  'twitter_title', 'twitter_description', 'featured_image', 'featured_image_alt', 'featured_image_variants',
  'author_admin_id', 'author_name', 'category_id', 'status', 'is_featured', 'allow_indexing',
  'estimated_reading_time', 'word_count', 'seo_score', 'seo_warnings',
  'source_type', 'source_file', 'source_hash', 'ai_generated', 'ai_model', 'ai_review_status',
  'published_at', 'scheduled_at', 'created_at', 'updated_at', 'deleted_at',
];

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
  });

  let failed = 0;

  for (const table of REQUIRED_TABLES) {
    const [rows] = await conn.query(
      `SELECT COUNT(*) AS c FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [table]
    );
    if (!rows[0].c) {
      console.error(`MISSING TABLE: ${table}`);
      failed++;
    } else {
      console.log(`OK table: ${table}`);
    }
  }

  for (const col of REQUIRED_POST_COLUMNS) {
    const [rows] = await conn.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'blog_posts' AND COLUMN_NAME = ?`,
      [col]
    );
    if (!rows[0].c) {
      // legacy fallbacks
      if (col === 'robots_directive') {
        const [r2] = await conn.query(
          `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'blog_posts' AND COLUMN_NAME = 'robots'`
        );
        if (r2[0].c) continue;
      }
      if (col === 'source_hash') {
        const [r2] = await conn.query(
          `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'blog_posts' AND COLUMN_NAME = 'source_content_hash'`
        );
        if (r2[0].c) continue;
      }
      if (col === 'ai_generated') {
        const [r2] = await conn.query(
          `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'blog_posts' AND COLUMN_NAME = 'ai_rewritten'`
        );
        if (r2[0].c) continue;
      }
      console.error(`MISSING COLUMN: blog_posts.${col}`);
      failed++;
    }
  }

  const slug = `schema-test-${Date.now()}`;
  const fileHash = crypto.createHash('sha256').update(slug).digest('hex');

  try {
    await conn.beginTransaction();

    const [catRes] = await conn.query(
      `INSERT INTO blog_categories (name, slug, description) VALUES (?, ?, ?)`,
      ['Schema Test Cat', `cat-${Date.now()}`, 'temp']
    );
    const categoryId = catRes.insertId;

    const [tagRes] = await conn.query(
      `INSERT INTO blog_tags (name, slug) VALUES (?, ?)`,
      ['Schema Test Tag', `tag-${Date.now()}`]
    );
    const tagId = tagRes.insertId;

    const [postRes] = await conn.query(
      `
      INSERT INTO blog_posts (
        title, slug, subtitle, excerpt, content_html, meta_title, meta_description,
        focus_keyword, robots_directive, category_id, status, author_name, source_type, source_hash, word_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, 'manual', ?, 42)
      `,
      [
        'Schema Test Post',
        slug,
        'Sub',
        'Excerpt',
        '<p>Test</p>',
        'Meta',
        'Desc',
        'pemf',
        'noindex,nofollow',
        categoryId,
        'QA Bot',
        fileHash,
      ]
    );
    const postId = postRes.insertId;

    await conn.query(`INSERT INTO blog_post_tags (post_id, tag_id) VALUES (?, ?)`, [postId, tagId]);

    const jobKey = crypto.randomBytes(8).toString('hex');
    const [jobRes] = await conn.query(
      `
      INSERT INTO blog_import_jobs (job_key, job_type, total_files, pending_count, status)
      VALUES (?, 'directory_scan', 1, 1, 'pending')
      `,
      [jobKey]
    );
    const jobId = jobRes.insertId;

    await conn.query(
      `
      INSERT INTO blog_import_items (job_id, file_name, file_hash, status, post_id)
      VALUES (?, ?, ?, 'completed', ?)
      `,
      [jobId, 'test.html', fileHash, postId]
    );

    await conn.query(
      `
      INSERT INTO blog_revisions (post_id, revision_number, snapshot_json)
      VALUES (?, 1, ?)
      `,
      [postId, JSON.stringify({ title: 'Schema Test Post', slug })]
    );

    await conn.query(
      `INSERT INTO blog_redirects (post_id, old_slug) VALUES (?, ?)`,
      [postId, `${slug}-old`]
    );

    await conn.query(
      `
      INSERT INTO blog_audit_logs (action, entity_type, entity_id, metadata_json, ip_hash)
      VALUES ('post.create', 'blog_post', ?, ?, ?)
      `,
      [postId, JSON.stringify({ slug }), crypto.createHash('sha256').update('127.0.0.1').digest('hex')]
    );

    const [[{ cnt }]] = await conn.query(
      `SELECT COUNT(*) AS cnt FROM blog_posts WHERE id = ? AND deleted_at IS NULL`,
      [postId]
    );
    if (!cnt) throw new Error('Post read failed');

    await conn.rollback();
    console.log('OK CRUD smoke test (rolled back)');
  } catch (err) {
    await conn.rollback();
    console.error('CRUD test failed:', err.message);
    failed++;
  }

  await conn.end();

  if (failed) {
    console.error(`\nVerification FAILED (${failed} issue(s))`);
    process.exit(1);
  }
  console.log('\nVerification PASSED');
}

main();
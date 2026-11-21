'use strict';

const crypto = require('crypto');
const { parseCsv } = require('../utils/csvParse');
const slugify = require('../utils/slugify');
const blogRepository = require('./blogRepository');

async function importCsv(db, csvText, { adminId, updateExisting = false }) {
  const rows = parseCsv(csvText);
  const batchKey = crypto.randomBytes(12).toString('hex');
  let imported = 0;
  let skipped = 0;
  let failed = 0;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [batchResult] = await conn.query(
      `
      INSERT INTO blog_import_batches (batch_key, source_type, status, total_rows, created_by_admin_id)
      VALUES (:batch_key, 'csv', 'processing', :total_rows, :admin_id)
      `,
      { batch_key: batchKey, total_rows: rows.length, admin_id: adminId }
    );
    const batchId = batchResult.insertId;

    for (const row of rows) {
      try {
        const title = row.title || row.name;
        if (!title) {
          failed++;
          continue;
        }

        const content = row.content_html || row.content || row.body || '';
        const slug = row.slug ? slugify(row.slug) : await blogRepository.uniqueSlug(db, title);
        const hash = content && String(content).trim() ? blogRepository.contentHash(content) : null;

        const [existingBySlug] = await conn.query(
          'SELECT id, slug FROM blog_posts WHERE slug = :slug LIMIT 1',
          { slug }
        );
        const [existingByHash] = hash
          ? await conn.query(
              'SELECT id FROM blog_posts WHERE source_hash = :hash LIMIT 1',
              { hash }
            )
          : [[]];

        if ((existingBySlug.length || existingByHash.length) && !updateExisting) {
          skipped++;
          continue;
        }

        if (existingBySlug.length && updateExisting) {
          await conn.query(
            `
            UPDATE blog_posts SET
              title = :title,
              excerpt = :excerpt,
              content_html = :content_html,
              meta_title = :meta_title,
              meta_description = :meta_description,
              source_url = :source_url,
              source_hash = :hash,
              status = 'draft',
              updated_at = NOW()
            WHERE id = :id
            `,
            {
              id: existingBySlug[0].id,
              title,
              excerpt: row.excerpt || null,
              content_html: content || null,
              meta_title: row.meta_title || null,
              meta_description: row.meta_description || null,
              source_url: row.source_url || null,
              hash,
            }
          );
          imported++;
          continue;
        }

        await conn.query(
          `
          INSERT INTO blog_posts (
            title, slug, excerpt, content_html, status, meta_title, meta_description,
            source_url, source_hash, author_admin_id, source_type
          ) VALUES (
            :title, :slug, :excerpt, :content_html, 'draft', :meta_title, :meta_description,
            :source_url, :hash, :admin_id, 'csv'
          )
          `,
          {
            title,
            slug,
            excerpt: row.excerpt || null,
            content_html: content || null,
            meta_title: row.meta_title || null,
            meta_description: row.meta_description || null,
            source_url: row.source_url || null,
            hash,
            admin_id: adminId,
          }
        );
        imported++;
      } catch (e) {
        failed++;
      }
    }

    await conn.query(
      `
      UPDATE blog_import_batches SET
        status = 'completed',
        imported_count = :imported,
        skipped_count = :skipped,
        failed_count = :failed
      WHERE id = :id
      `,
      { id: batchId, imported, skipped, failed }
    );

    await conn.commit();
    return { batchKey, total: rows.length, imported, skipped, failed };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { importCsv };
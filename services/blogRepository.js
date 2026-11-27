'use strict';

const crypto = require('crypto');
const slugify = require('../utils/slugify');
const { computeWordCount, computeReadingMinutes } = require('../utils/blogPostMetrics');
const { sanitizeBlogHtml } = require('../utils/sanitizeBlogHtml');

function contentHash(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

function normalizeRow(row) {
  if (!row) return row;
  row.robots = row.robots_directive ?? row.robots;
  row.source_content_hash = row.source_hash ?? row.source_content_hash;
  row.ai_rewritten = row.ai_generated ?? row.ai_rewritten;
  return row;
}

/** MySQL JSON columns need a string; arrays from mysql2 must not be bound raw. */
function jsonColumnForDb(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    const t = value.trim();
    if (!t) return null;
    try {
      JSON.parse(t);
      return t;
    } catch {
      return JSON.stringify(value);
    }
  }
  return JSON.stringify(value);
}

const NOT_DELETED = 'deleted_at IS NULL';

async function listPosts(db, { q, status, page, limit, sort, dir }) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 5), 100);
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const offset = (safePage - 1) * safeLimit;
  const sortCol = ['created_at', 'updated_at', 'title', 'published_at', 'status'].includes(sort)
    ? sort
    : 'updated_at';
  const sortDir = dir === 'asc' ? 'ASC' : 'DESC';

  const where = [NOT_DELETED];
  const params = {};

  if (q) {
    where.push('(title LIKE :q OR slug LIKE :q OR excerpt LIKE :q)');
    params.q = `%${q}%`;
  }
  if (status && status !== 'all') {
    where.push('status = :status');
    params.status = status;
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;

  const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM blog_posts ${whereSql}`, params);

  const [rows] = await db.query(
    `
    SELECT id, title, slug, excerpt, status, featured_image, meta_title,
           published_at, scheduled_at, ai_generated, is_featured, seo_score,
           created_at, updated_at
    FROM blog_posts
    ${whereSql}
    ORDER BY ${sortCol} ${sortDir}
    LIMIT :limit OFFSET :offset
    `,
    { ...params, limit: safeLimit, offset }
  );

  return {
    rows: rows.map(normalizeRow),
    pagination: { page: safePage, limit: safeLimit, total },
  };
}

async function countPublishedPosts(db) {
  const [[row]] = await db.query(
    `SELECT COUNT(*) AS total FROM blog_posts WHERE ${NOT_DELETED} AND status = 'published'`
  );
  return Number(row?.total) || 0;
}

async function getPostById(db, id) {
  const [rows] = await db.query(
    `SELECT * FROM blog_posts WHERE id = :id AND ${NOT_DELETED} LIMIT 1`,
    { id }
  );
  return normalizeRow(rows[0] || null);
}

async function getPostBySlug(db, slug, { publishedOnly = false } = {}) {
  const parts = ['slug = :slug', NOT_DELETED];
  if (publishedOnly) {
    parts.push("status = 'published'", 'allow_indexing = 1');
  }
  const [rows] = await db.query(
    `SELECT * FROM blog_posts WHERE ${parts.join(' AND ')} LIMIT 1`,
    { slug }
  );
  return normalizeRow(rows[0] || null);
}

async function getRedirectTarget(db, oldSlug) {
  const [rows] = await db.query(
    `
    SELECT p.slug, p.id
    FROM blog_redirects r
    INNER JOIN blog_posts p ON p.id = r.post_id
    WHERE r.old_slug = :slug AND p.deleted_at IS NULL
    LIMIT 1
    `,
    { slug: oldSlug }
  );
  return rows[0] || null;
}

async function slugExists(db, slug, excludeId = null) {
  const params = { slug };
  let sql = `SELECT id FROM blog_posts WHERE slug = :slug AND ${NOT_DELETED}`;
  if (excludeId) {
    sql += ' AND id <> :excludeId';
    params.excludeId = excludeId;
  }
  sql += ' LIMIT 1';
  const [rows] = await db.query(sql, params);
  return !!rows.length;
}

async function uniqueSlug(db, base, excludeId = null) {
  let candidate = slugify(base);
  let n = 0;
  while (await slugExists(db, candidate, excludeId)) {
    n += 1;
    candidate = `${slugify(base)}-${n}`;
  }
  return candidate;
}

async function createPost(db, data, adminId) {
  if (data.content_html !== undefined && data.content_html !== null) {
    data = { ...data, content_html: sanitizeBlogHtml(data.content_html) };
  }
  const slug = data.slug ? slugify(data.slug) : await uniqueSlug(db, data.title);
  if (await slugExists(db, slug)) {
    const err = new Error('Slug already exists');
    err.code = 'DUPLICATE_SLUG';
    throw err;
  }

  const raw = data.content_html || data.content_text;
  const fromContent = raw && String(raw).trim() ? contentHash(raw) : null;
  const explicitSource =
    data.source_hash != null && String(data.source_hash).trim() !== ''
      ? String(data.source_hash).trim().slice(0, 64)
      : null;
  /** Import jobs pass file SHA-256; placeholder bodies would otherwise share one content hash. */
  const hash = explicitSource || fromContent;
  const wordCount = computeWordCount(data.content_html);
  const readingMin = computeReadingMinutes(wordCount);
  const robots = data.robots_directive || data.robots || 'index,follow';

  const [result] = await db.query(
    `
    INSERT INTO blog_posts (
      title, slug, subtitle, excerpt, content_html, content_text, status,
      featured_image, featured_image_alt,
      meta_title, meta_description, meta_keywords, meta_abstract, focus_keyword, secondary_keywords, search_intent,
      canonical_url, og_title, og_description, og_image, twitter_title, twitter_description,
      robots_directive, source_url, source_hash, source_type, source_file,
      author_admin_id, author_name, category_id,
      is_featured, allow_indexing, word_count, estimated_reading_time,
      ai_generated, ai_model, ai_review_status, scheduled_at
    ) VALUES (
      :title, :slug, :subtitle, :excerpt, :content_html, :content_text, :status,
      :featured_image, :featured_image_alt,
      :meta_title, :meta_description, :meta_keywords, :meta_abstract, :focus_keyword, :secondary_keywords, :search_intent,
      :canonical_url, :og_title, :og_description, :og_image, :twitter_title, :twitter_description,
      :robots_directive, :source_url, :source_hash, :source_type, :source_file,
      :author_admin_id, :author_name, :category_id,
      :is_featured, :allow_indexing, :word_count, :estimated_reading_time,
      :ai_generated, :ai_model, :ai_review_status, :scheduled_at
    )
    `,
    {
      title: data.title,
      slug,
      subtitle: data.subtitle || null,
      excerpt: data.excerpt || null,
      content_html: data.content_html || null,
      content_text: data.content_text || null,
      status: data.status || 'draft',
      featured_image: data.featured_image || null,
      featured_image_alt: data.featured_image_alt || null,
      meta_title: data.meta_title || null,
      meta_description: data.meta_description || null,
      meta_keywords: data.meta_keywords || null,
      meta_abstract: data.meta_abstract || null,
      focus_keyword: data.focus_keyword || null,
      secondary_keywords: data.secondary_keywords || null,
      search_intent: data.search_intent || null,
      canonical_url: data.canonical_url || null,
      og_title: data.og_title || null,
      og_description: data.og_description || null,
      og_image: data.og_image || null,
      twitter_title: data.twitter_title || null,
      twitter_description: data.twitter_description || null,
      robots_directive: robots,
      source_url: data.source_url || null,
      source_hash: hash,
      source_type: data.source_type || 'manual',
      source_file: data.source_file || null,
      author_admin_id: adminId,
      author_name: data.author_name || null,
      category_id: data.category_id || null,
      is_featured: data.is_featured ? 1 : 0,
      allow_indexing: data.allow_indexing !== false && data.allow_indexing !== 0 ? 1 : 0,
      word_count: wordCount || null,
      estimated_reading_time: readingMin,
      ai_generated: data.ai_generated ? 1 : 0,
      ai_model: data.ai_model || null,
      ai_review_status: data.ai_review_status || 'none',
      scheduled_at: data.scheduled_at || null,
    }
  );
  return result.insertId;
}

async function updatePost(db, id, data, { allowPublish = false } = {}) {
  const existing = await getPostById(db, id);
  if (!existing) return false;

  if (data.content_html !== undefined && data.content_html !== null) {
    data = { ...data, content_html: sanitizeBlogHtml(data.content_html) };
  }

  let slug = data.slug ? slugify(data.slug) : existing.slug;
  if (slug !== existing.slug && (await slugExists(db, slug, id))) {
    const err = new Error('Slug already exists');
    err.code = 'DUPLICATE_SLUG';
    throw err;
  }

  if (
    slug !== existing.slug &&
    existing.status === 'published' &&
    existing.published_at
  ) {
    await db.query(
      `INSERT IGNORE INTO blog_redirects (post_id, old_slug, is_permanent) VALUES (:post_id, :old_slug, 1)`,
      { post_id: id, old_slug: existing.slug }
    );
  }

  let status = data.status || existing.status;
  if (!allowPublish && status === 'published' && existing.status !== 'published') {
    status = existing.status === 'published' ? 'published' : 'review';
  }

  let published_at = existing.published_at;
  if (status === 'published' && allowPublish && !published_at) {
    published_at = new Date();
  } else if (status !== 'published' && existing.status === 'published' && status !== 'published') {
    published_at = null;
  }

  const content_html = data.content_html !== undefined ? data.content_html : existing.content_html;
  const hash =
    content_html && String(content_html).trim()
      ? contentHash(content_html)
      : existing.source_hash || existing.source_content_hash;
  const wordCount = computeWordCount(content_html);
  const readingMin = computeReadingMinutes(wordCount);
  const robots =
    data.robots_directive ?? data.robots ?? existing.robots_directive ?? existing.robots;

  await db.query(
    `
    UPDATE blog_posts SET
      title = :title,
      slug = :slug,
      subtitle = :subtitle,
      excerpt = :excerpt,
      content_html = :content_html,
      content_text = :content_text,
      status = :status,
      featured_image = :featured_image,
      featured_image_alt = :featured_image_alt,
      meta_title = :meta_title,
      meta_description = :meta_description,
      meta_keywords = :meta_keywords,
      meta_abstract = :meta_abstract,
      focus_keyword = :focus_keyword,
      secondary_keywords = :secondary_keywords,
      search_intent = :search_intent,
      canonical_url = :canonical_url,
      og_title = :og_title,
      og_description = :og_description,
      og_image = :og_image,
      twitter_title = :twitter_title,
      twitter_description = :twitter_description,
      robots_directive = :robots_directive,
      source_url = :source_url,
      source_hash = :source_hash,
      category_id = :category_id,
      author_name = :author_name,
      is_featured = :is_featured,
      allow_indexing = :allow_indexing,
      word_count = :word_count,
      estimated_reading_time = :estimated_reading_time,
      seo_score = :seo_score,
      seo_warnings = :seo_warnings,
      scheduled_at = :scheduled_at,
      published_at = :published_at,
      ai_generated = :ai_generated,
      ai_model = :ai_model,
      ai_review_status = :ai_review_status
    WHERE id = :id
    `,
    {
      id,
      title: data.title ?? existing.title,
      slug,
      subtitle: data.subtitle ?? existing.subtitle,
      excerpt: data.excerpt ?? existing.excerpt,
      content_html,
      content_text: data.content_text ?? existing.content_text,
      status,
      featured_image: data.featured_image ?? existing.featured_image,
      featured_image_alt: data.featured_image_alt ?? existing.featured_image_alt,
      meta_title: data.meta_title ?? existing.meta_title,
      meta_description: data.meta_description ?? existing.meta_description,
      meta_keywords: data.meta_keywords ?? existing.meta_keywords,
      meta_abstract: data.meta_abstract ?? existing.meta_abstract,
      focus_keyword: data.focus_keyword ?? existing.focus_keyword,
      secondary_keywords: data.secondary_keywords ?? existing.secondary_keywords,
      search_intent: data.search_intent ?? existing.search_intent,
      canonical_url: data.canonical_url ?? existing.canonical_url,
      og_title: data.og_title ?? existing.og_title,
      og_description: data.og_description ?? existing.og_description,
      og_image: data.og_image ?? existing.og_image,
      twitter_title: data.twitter_title ?? existing.twitter_title,
      twitter_description: data.twitter_description ?? existing.twitter_description,
      robots_directive: robots,
      source_url: data.source_url ?? existing.source_url,
      source_hash: hash,
      category_id: data.category_id ?? existing.category_id,
      author_name: data.author_name ?? existing.author_name,
      is_featured: data.is_featured !== undefined ? (data.is_featured ? 1 : 0) : existing.is_featured,
      allow_indexing:
        data.allow_indexing !== undefined
          ? data.allow_indexing
            ? 1
            : 0
          : existing.allow_indexing ?? 1,
      word_count: wordCount || existing.word_count,
      estimated_reading_time: readingMin ?? existing.estimated_reading_time,
      seo_score: data.seo_score ?? existing.seo_score,
      seo_warnings:
        data.seo_warnings !== undefined
          ? jsonColumnForDb(data.seo_warnings)
          : jsonColumnForDb(existing.seo_warnings),
      scheduled_at: data.scheduled_at ?? existing.scheduled_at,
      published_at,
      ai_generated:
        data.ai_generated !== undefined
          ? data.ai_generated
            ? 1
            : 0
          : existing.ai_generated ?? existing.ai_rewritten,
      ai_model: data.ai_model ?? existing.ai_model,
      ai_review_status: data.ai_review_status ?? existing.ai_review_status ?? 'none',
    }
  );
  if (
    existing.status === 'published' ||
    status === 'published' ||
    slug !== existing.slug
  ) {
    try {
      require('./blogPublicService').bustPublicCache();
    } catch {
      /* optional */
    }
  }
  return true;
}

async function publishPost(db, id) {
  const existing = await getPostById(db, id);
  if (!existing) return false;
  await db.query(
    `
    UPDATE blog_posts SET status = 'published', published_at = COALESCE(published_at, NOW())
    WHERE id = :id AND ${NOT_DELETED}
    `,
    { id }
  );
  try {
    require('./blogPublicService').bustPublicCache();
  } catch {
    /* optional */
  }
  return true;
}

async function getTrashedPostById(db, id) {
  const [rows] = await db.query(
    `SELECT * FROM blog_posts WHERE id = :id AND deleted_at IS NOT NULL LIMIT 1`,
    { id }
  );
  return normalizeRow(rows[0] || null);
}

async function listTrashedPosts(db, { page = 1, limit = 20 } = {}) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 5), 100);
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const offset = (safePage - 1) * safeLimit;
  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM blog_posts WHERE deleted_at IS NOT NULL`
  );
  const [rows] = await db.query(
    `
    SELECT id, title, slug, status, deleted_at, updated_at
    FROM blog_posts
    WHERE deleted_at IS NOT NULL
    ORDER BY deleted_at DESC
    LIMIT :limit OFFSET :offset
    `,
    { limit: safeLimit, offset }
  );
  return { rows: rows.map(normalizeRow), pagination: { page: safePage, limit: safeLimit, total } };
}

async function deletePost(db, id, { hard = false } = {}) {
  if (hard) {
    const [result] = await db.query('DELETE FROM blog_posts WHERE id = :id', { id });
    if (result.affectedRows > 0) {
      try {
        require('./blogPublicService').bustPublicCache();
      } catch {
        /* optional */
      }
    }
    return result.affectedRows > 0;
  }
  const [result] = await db.query(
    `UPDATE blog_posts SET deleted_at = NOW(), status = 'archived' WHERE id = :id AND ${NOT_DELETED}`,
    { id }
  );
  if (result.affectedRows > 0) {
    try {
      require('./blogPublicService').bustPublicCache();
    } catch {
      /* optional */
    }
  }
  return result.affectedRows > 0;
}

async function restorePost(db, id, { status = 'draft' } = {}) {
  const trashed = await getTrashedPostById(db, id);
  if (!trashed) return { ok: false, reason: 'NOT_IN_TRASH' };

  const safeStatus = ['draft', 'review', 'scheduled'].includes(status) ? status : 'draft';
  let slug = trashed.slug;
  if (await slugExists(db, slug)) {
    slug = await uniqueSlug(db, trashed.title || slug, id);
  }

  await db.query(
    `
    UPDATE blog_posts SET
      deleted_at = NULL,
      status = :status,
      slug = :slug,
      published_at = IF(:status = 'published', published_at, NULL)
    WHERE id = :id
    `,
    { id, status: safeStatus, slug }
  );
  return { ok: true, slug, status: safeStatus };
}

async function unpublishPost(db, id) {
  const existing = await getPostById(db, id);
  if (!existing) return false;
  await db.query(
    `
    UPDATE blog_posts SET status = 'draft', allow_indexing = 1
    WHERE id = :id AND ${NOT_DELETED}
    `,
    { id }
  );
  try {
    require('./blogPublicService').bustPublicCache();
  } catch {
    /* optional */
  }
  return true;
}

async function listPublished(db, { page, limit }) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 12, 6), 48);
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const offset = (safePage - 1) * safeLimit;

  const [[{ total }]] = await db.query(
    `
    SELECT COUNT(*) AS total FROM blog_posts
    WHERE status = 'published' AND ${NOT_DELETED} AND allow_indexing = 1
    `
  );

  const [rows] = await db.query(
    `
    SELECT id, title, slug, excerpt, featured_image, featured_image_alt, featured_image_variants, meta_description,
           published_at, created_at, estimated_reading_time, is_featured
    FROM blog_posts
    WHERE status = 'published' AND ${NOT_DELETED} AND allow_indexing = 1
    ORDER BY is_featured DESC, COALESCE(published_at, created_at) DESC
    LIMIT :limit OFFSET :offset
    `,
    { limit: safeLimit, offset }
  );

  return { rows, pagination: { page: safePage, limit: safeLimit, total } };
}

module.exports = {
  listPosts,
  countPublishedPosts,
  getPostById,
  getPostBySlug,
  getTrashedPostById,
  listTrashedPosts,
  getRedirectTarget,
  createPost,
  updatePost,
  publishPost,
  unpublishPost,
  deletePost,
  restorePost,
  listPublished,
  uniqueSlug,
  contentHash,
  slugExists,
  normalizeRow,
  jsonColumnForDb,
};
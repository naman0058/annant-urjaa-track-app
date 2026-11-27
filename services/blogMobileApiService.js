'use strict';

const { blogAiConfig } = require('../config/blogAiConfig');
const blogRepository = require('./blogRepository');
const { buildResponsiveImage } = require('../utils/blogImageView');
const { sanitizePublicHtml } = require('../utils/sanitizePublicHtml');

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;

/** Same visibility rules as public web listings. */
const PUBLIC_WHERE = `
  p.status = 'published'
  AND p.deleted_at IS NULL
  AND p.allow_indexing = 1
  AND (p.published_at IS NULL OR p.published_at <= NOW())
`;

const LIST_SELECT = `
  p.id,
  p.title,
  p.slug,
  p.excerpt,
  p.featured_image,
  p.featured_image_variants,
  p.published_at,
  p.created_at,
  p.estimated_reading_time,
  c.name AS category_name,
  c.slug AS category_slug
`;

function siteBase() {
  return (
    process.env.SITE_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    blogAiConfig.siteBaseUrl ||
    ''
  ).replace(/\/$/, '');
}

function parseLimit(raw) {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_LIMIT;
  const n = parseInt(String(raw), 10);
  if (Number.isNaN(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

function sortTimestamp(row) {
  return row.published_at || row.created_at;
}

function encodeCursor(row) {
  const ts = sortTimestamp(row);
  const iso = ts ? new Date(ts).toISOString() : '';
  const payload = { p: iso, i: Number(row.id) };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCursor(cursor) {
  if (!cursor || !String(cursor).trim()) return null;
  try {
    const json = Buffer.from(String(cursor).trim(), 'base64url').toString('utf8');
    const payload = JSON.parse(json);
    const id = Number(payload.i);
    if (!id || Number.isNaN(id)) return { invalid: true };
    const publishedAt = payload.p ? String(payload.p) : null;
    if (publishedAt && Number.isNaN(Date.parse(publishedAt))) return { invalid: true };
    return { publishedAt, id };
  } catch {
    return { invalid: true };
  }
}

function pickThumbnailUrl(row, base) {
  const built = buildResponsiveImage({
    featured: row.featured_image,
    variants: row.featured_image_variants,
    siteBase: base,
  });
  return built?.src || null;
}

function mapCategory(row) {
  if (!row.category_slug) return null;
  return { name: row.category_name || '', slug: row.category_slug };
}

function mapListRow(row, base) {
  const thumb = pickThumbnailUrl(row, base);
  const pub = row.published_at || row.created_at;
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt || '',
    thumbnail_url: thumb,
    featured_image_url: thumb,
    category: mapCategory(row),
    published_at: pub ? new Date(pub).toISOString() : null,
    reading_time_minutes: row.estimated_reading_time ?? null,
  };
}

function absolutizeHtmlAssets(html, base) {
  if (!base || !html) return html || '';
  return String(html).replace(/(\s(?:src|href)\s*=\s*["'])(\/[^"']+)/gi, `$1${base}$2`);
}

async function listBlogs(db, { limit: limitRaw, cursor } = {}) {
  const limit = parseLimit(limitRaw);
  const decoded = cursor ? decodeCursor(cursor) : null;
  if (decoded?.invalid) {
    const err = new Error('Invalid cursor');
    err.code = 'INVALID_CURSOR';
    throw err;
  }

  const base = siteBase();
  const params = { fetchLimit: limit + 1 };
  const where = [PUBLIC_WHERE];

  if (decoded) {
    where.push(`
      (
        COALESCE(p.published_at, p.created_at) < :cursorTs
        OR (
          COALESCE(p.published_at, p.created_at) = :cursorTs
          AND p.id < :cursorId
        )
      )
    `);
    params.cursorTs = decoded.publishedAt ? new Date(decoded.publishedAt) : new Date(0);
    params.cursorId = decoded.id;
  }

  const [rows] = await db.query(
    `
    SELECT ${LIST_SELECT}
    FROM blog_posts p
    LEFT JOIN blog_categories c ON c.id = p.category_id
    WHERE ${where.join(' AND ')}
    ORDER BY COALESCE(p.published_at, p.created_at) DESC, p.id DESC
    LIMIT :fetchLimit
    `,
    params
  );

  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  const blogs = slice.map((r) => mapListRow(r, base));
  const next_cursor = hasMore && slice.length ? encodeCursor(slice[slice.length - 1]) : null;

  return {
    blogs,
    limit,
    has_more: hasMore,
    next_cursor,
  };
}

function isPubliclyVisible(post) {
  if (!post) return false;
  if (post.status !== 'published') return false;
  if (post.deleted_at) return false;
  if (post.allow_indexing === 0 || post.allow_indexing === false) return false;
  if (post.published_at && new Date(post.published_at).getTime() > Date.now()) return false;
  return true;
}

async function getBlogDetail(db, slug) {
  const clean = String(slug || '').trim();
  if (!clean) return null;

  const post = await blogRepository.getPostBySlug(db, clean, { publishedOnly: true });
  if (!isPubliclyVisible(post)) return null;

  const base = siteBase();
  let category = null;
  if (post.category_id) {
    const [cats] = await db.query(
      `SELECT name, slug FROM blog_categories WHERE id = :id LIMIT 1`,
      { id: post.category_id }
    );
    if (cats[0]) {
      category = { name: cats[0].name, slug: cats[0].slug };
    }
  }

  const featured = pickThumbnailUrl(post, base);
  const rawHtml = post.content_html || '';
  const safeHtml = sanitizePublicHtml(rawHtml);
  const content_html = absolutizeHtmlAssets(safeHtml, base);
  const pub = post.published_at || post.created_at;

  return {
    id: post.id,
    title: post.title,
    slug: post.slug,
    featured_image_url: featured,
    content_html,
    author: post.author_name || blogAiConfig.defaultAuthor || 'Editorial Team',
    published_at: pub ? new Date(pub).toISOString() : null,
    category,
    reading_time_minutes: post.estimated_reading_time ?? null,
  };
}

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  parseLimit,
  encodeCursor,
  decodeCursor,
  listBlogs,
  getBlogDetail,
  siteBase,
};
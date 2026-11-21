'use strict';

const blogRepository = require('./blogRepository');
const blogPublicCache = require('./blogPublicCache');
const { DEFAULT_LIMIT, resolvePagination } = require('../utils/blogPagination');

const PUBLIC_FILTER = `p.status = 'published' AND p.deleted_at IS NULL AND p.allow_indexing = 1`;

const LIST_SELECT = `
  p.id, p.title, p.slug, p.excerpt,
  p.featured_image, p.featured_image_alt, p.featured_image_variants,
  p.published_at, p.updated_at, p.estimated_reading_time, p.author_name,
  c.name AS category_name, c.slug AS category_slug
`;

function listCacheKey({ page, limit, q, categorySlug }) {
  return `list:${page}:${limit}:${categorySlug || ''}:${q || ''}`;
}

async function countPublishedPublic(db, { q, categorySlug } = {}) {
  const where = [PUBLIC_FILTER];
  const params = {};
  if (categorySlug) {
    where.push('c.slug = :categorySlug');
    params.categorySlug = categorySlug;
  }
  if (q) {
    where.push('(p.title LIKE :q OR p.excerpt LIKE :q OR p.meta_description LIKE :q)');
    params.q = `%${q.slice(0, 120)}%`;
  }
  const [[row]] = await db.query(
    `
    SELECT COUNT(*) AS total FROM blog_posts p
    LEFT JOIN blog_categories c ON c.id = p.category_id
    WHERE ${where.join(' AND ')}
    `,
    params
  );
  return Number(row.total) || 0;
}

async function listPublishedPublic(db, options = {}) {
  const { pageRaw, q, categorySlug } = options;
  const limit = DEFAULT_LIMIT;
  const total = await countPublishedPublic(db, { q, categorySlug });
  const { page, invalidPage, totalPages, offset } = resolvePagination({
    pageRaw,
    total,
  });

  const cacheKey = listCacheKey({ page, limit, q, categorySlug });
  const cached = blogPublicCache.get(cacheKey);
  if (cached) return { ...cached, fromCache: true };

  const where = [PUBLIC_FILTER];
  const params = { limit, offset };
  if (categorySlug) {
    where.push('c.slug = :categorySlug');
    params.categorySlug = categorySlug;
  }
  if (q) {
    where.push('(p.title LIKE :q OR p.excerpt LIKE :q OR p.meta_description LIKE :q)');
    params.q = `%${q.slice(0, 120)}%`;
  }

  const [rows] = await db.query(
    `
    SELECT ${LIST_SELECT}
    FROM blog_posts p
    LEFT JOIN blog_categories c ON c.id = p.category_id
    WHERE ${where.join(' AND ')}
    ORDER BY p.is_featured DESC, COALESCE(p.published_at, p.created_at) DESC
    LIMIT :limit OFFSET :offset
    `,
    params
  );

  const result = {
    rows,
    pagination: { page, limit, total, totalPages },
    invalidPage,
    q: q || '',
    categorySlug: categorySlug || '',
  };
  if (!q) blogPublicCache.set(cacheKey, result);
  return result;
}

async function getCategoryBySlug(db, slug) {
  const key = `cat:${slug}`;
  const hit = blogPublicCache.get(key);
  if (hit) return hit;
  const [rows] = await db.query(
    `SELECT id, name, slug, description FROM blog_categories WHERE slug = :slug LIMIT 1`,
    { slug }
  );
  const cat = rows[0] || null;
  if (cat) blogPublicCache.set(key, cat);
  return cat;
}

async function listCategoriesWithCounts(db) {
  const key = 'categories:counts';
  const hit = blogPublicCache.get(key);
  if (hit) return hit;
  const [rows] = await db.query(
    `
    SELECT c.id, c.name, c.slug, COUNT(p.id) AS post_count
    FROM blog_categories c
    INNER JOIN blog_posts p ON p.category_id = c.id
      AND p.status = 'published' AND p.deleted_at IS NULL AND p.allow_indexing = 1
    GROUP BY c.id, c.name, c.slug
    HAVING post_count > 0
    ORDER BY c.name ASC
    `
  );
  blogPublicCache.set(key, rows);
  return rows;
}

async function getPublishedPostBySlug(db, slug) {
  const post = await blogRepository.getPostBySlug(db, slug, { publishedOnly: true });
  if (!post) return null;

  if (post.category_id) {
    const [cats] = await db.query(
      `SELECT name, slug FROM blog_categories WHERE id = :id LIMIT 1`,
      { id: post.category_id }
    );
    if (cats[0]) {
      post.category_name = cats[0].name;
      post.category_slug = cats[0].slug;
    }
  }
  return post;
}

async function listRelatedPublic(db, postId, categoryId, limit = 3) {
  const params = { id: postId, limit };
  let extra = '';
  if (categoryId) {
    extra = 'AND p.category_id = :categoryId';
    params.categoryId = categoryId;
  }
  const [rows] = await db.query(
    `
    SELECT ${LIST_SELECT}
    FROM blog_posts p
    LEFT JOIN blog_categories c ON c.id = p.category_id
    WHERE ${PUBLIC_FILTER} AND p.id <> :id ${extra}
    ORDER BY COALESCE(p.published_at, p.created_at) DESC
    LIMIT :limit
    `,
    params
  );
  return rows;
}

function bustPublicCache() {
  blogPublicCache.bustAll();
}

module.exports = {
  listPublishedPublic,
  getPublishedPostBySlug,
  listRelatedPublic,
  listCategoriesWithCounts,
  getCategoryBySlug,
  bustPublicCache,
};
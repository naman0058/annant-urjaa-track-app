'use strict';

/** Known public site paths (must exist as Express routes). */
const SITE_PAGES = Object.freeze([
  { path: '/', title: 'Home' },
  { path: '/about', title: 'About Us' },
  { path: '/programs', title: 'Programs' },
  { path: '/why-pemf', title: 'Why PEMF' },
  { path: '/blog', title: 'Blog' },
  { path: '/contact', title: 'Contact Us' },
]);

async function listPublishedBlogPaths(db, { limit = 500 } = {}) {
  const [rows] = await db.query(
    `
    SELECT id, title, slug, focus_keyword, category_id
    FROM blog_posts
    WHERE status = 'published' AND deleted_at IS NULL AND allow_indexing = 1
    ORDER BY published_at DESC
    LIMIT :limit
    `,
    { limit: Math.min(limit, 500) }
  );
  return rows.map((r) => ({
    path: `/blog/${r.slug}`,
    title: r.title,
    id: r.id,
    focus_keyword: r.focus_keyword,
  }));
}

function normalizeSuggestionPath(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (s.startsWith('/blog/')) return s.split('?')[0].split('#')[0];
  if (!s.startsWith('/') && /^[a-z0-9-]+$/i.test(s)) return `/blog/${s}`;
  return null;
}

/**
 * Validate AI/editor suggestions against real published posts only.
 */
async function resolveInternalSuggestions(db, suggestions) {
  const published = await listPublishedBlogPaths(db);
  const byPath = new Map(published.map((p) => [p.path.toLowerCase(), p]));

  const out = [];
  for (const raw of suggestions || []) {
    const path =
      typeof raw === 'string'
        ? normalizeSuggestionPath(raw)
        : normalizeSuggestionPath(raw.path || raw.slug || raw.url);
    if (!path) continue;
    const hit = byPath.get(path.toLowerCase());
    if (hit) {
      out.push({ path: hit.path, title: hit.title, verified: true });
    }
  }
  return out.slice(0, 15);
}

/**
 * Recommend internal links for an admin post: same category published + fixed site pages.
 */
async function recommendLinksForPost(db, postId, { limit = 8 } = {}) {
  const [postRows] = await db.query(
    `SELECT id, title, slug, category_id, focus_keyword FROM blog_posts WHERE id = :id LIMIT 1`,
    { id: postId }
  );
  const post = postRows[0];
  if (!post) return { sitePages: SITE_PAGES, blogPosts: [], verifiedFromAi: [] };

  let blogPosts = [];
  if (post.category_id) {
    const [rows] = await db.query(
      `
      SELECT id, title, slug FROM blog_posts
      WHERE category_id = :cat AND id <> :id
        AND status = 'published' AND deleted_at IS NULL AND allow_indexing = 1
      ORDER BY published_at DESC LIMIT :limit
      `,
      { cat: post.category_id, id: postId, limit }
    );
    blogPosts = rows.map((r) => ({ path: `/blog/${r.slug}`, title: r.title, reason: 'Same category' }));
  }

  if (blogPosts.length < limit) {
    const [rows] = await db.query(
      `
      SELECT id, title, slug FROM blog_posts
      WHERE id <> :id AND status = 'published' AND deleted_at IS NULL AND allow_indexing = 1
      ORDER BY published_at DESC LIMIT :limit
      `,
      { id: postId, limit: limit - blogPosts.length }
    );
    for (const r of rows) {
      if (!blogPosts.find((b) => b.path === `/blog/${r.slug}`)) {
        blogPosts.push({ path: `/blog/${r.slug}`, title: r.title, reason: 'Recent published' });
      }
    }
  }

  const [jsonRow] = await db.query(`SELECT content_json FROM blog_posts WHERE id = :id`, { id: postId });
  let verifiedFromAi = [];
  try {
    const json = jsonRow[0]?.content_json ? JSON.parse(jsonRow[0].content_json) : {};
    verifiedFromAi = await resolveInternalSuggestions(db, json.internal_link_suggestions);
  } catch {
    verifiedFromAi = [];
  }

  return { sitePages: SITE_PAGES, blogPosts, verifiedFromAi };
}

module.exports = {
  SITE_PAGES,
  listPublishedBlogPaths,
  resolveInternalSuggestions,
  recommendLinksForPost,
};
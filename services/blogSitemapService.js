'use strict';

const { absoluteUrl } = require('./blogSeoMeta');

/** Public marketing pages — preserve existing site URLs in sitemap. */
const STATIC_ENTRIES = [
  { path: '/', changefreq: 'weekly', priority: '1.0' },
  { path: '/about', changefreq: 'monthly', priority: '0.8' },
  { path: '/programs', changefreq: 'weekly', priority: '0.9' },
  { path: '/why-pemf', changefreq: 'monthly', priority: '0.8' },
  { path: '/contact', changefreq: 'monthly', priority: '0.7' },
  { path: '/blog', changefreq: 'daily', priority: '0.9' },
  { path: '/privacy-policy', changefreq: 'yearly', priority: '0.3' },
  { path: '/terms-and-conditions', changefreq: 'yearly', priority: '0.3' },
];

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatLastmod(d) {
  if (!d) return undefined;
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().split('T')[0];
}

async function listIndexablePosts(db) {
  const [rows] = await db.query(
    `
    SELECT slug, updated_at, published_at
    FROM blog_posts
    WHERE status = 'published'
      AND deleted_at IS NULL
      AND allow_indexing = 1
      AND (robots_directive IS NULL OR robots_directive NOT LIKE '%noindex%')
    ORDER BY COALESCE(published_at, updated_at) DESC
    `
  );
  return rows;
}

async function listIndexableCategories(db) {
  const [rows] = await db.query(
    `
    SELECT DISTINCT c.slug, MAX(p.updated_at) AS updated_at
    FROM blog_categories c
    INNER JOIN blog_posts p ON p.category_id = c.id
      AND p.status = 'published' AND p.deleted_at IS NULL AND p.allow_indexing = 1
      AND (p.robots_directive IS NULL OR p.robots_directive NOT LIKE '%noindex%')
    GROUP BY c.slug
  `
  );
  return rows;
}

async function buildSitemapXml(db, baseUrl) {
  const base = String(baseUrl || '').replace(/\/$/, '');
  const urls = [];

  for (const entry of STATIC_ENTRIES) {
    urls.push({
      loc: absoluteUrl(base, entry.path),
      changefreq: entry.changefreq,
      priority: entry.priority,
    });
  }

  const categories = await listIndexableCategories(db);
  for (const c of categories) {
    urls.push({
      loc: absoluteUrl(base, `/blog/category/${c.slug}`),
      lastmod: formatLastmod(c.updated_at),
      changefreq: 'weekly',
      priority: '0.75',
    });
  }

  const posts = await listIndexablePosts(db);
  for (const p of posts) {
    urls.push({
      loc: absoluteUrl(base, `/blog/${p.slug}`),
      lastmod: formatLastmod(p.updated_at || p.published_at),
      changefreq: 'monthly',
      priority: '0.65',
    });
  }

  const body = urls
    .map((u) => {
      const parts = [`  <url>`, `    <loc>${xmlEscape(u.loc)}</loc>`];
      if (u.lastmod) parts.push(`    <lastmod>${u.lastmod}</lastmod>`);
      if (u.changefreq) parts.push(`    <changefreq>${u.changefreq}</changefreq>`);
      if (u.priority) parts.push(`    <priority>${u.priority}</priority>`);
      parts.push(`  </url>`);
      return parts.join('\n');
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

module.exports = { buildSitemapXml, STATIC_ENTRIES, listIndexablePosts };
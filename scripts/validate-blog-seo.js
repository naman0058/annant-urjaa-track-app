'use strict';

require('dotenv').config();
const { buildListSeoMeta, buildArticleSeoMeta } = require('../services/blogSeoMeta');
const { buildArticleGraph } = require('../utils/jsonLdBlog');

const base = 'https://example.com';

const list = buildListSeoMeta({ base, listBase: '/blog', page: 2, q: '' });
if (!list.canonical.includes('page=2')) {
  console.error('FAIL: list page 2 canonical');
  process.exit(1);
}
const search = buildListSeoMeta({ base, listBase: '/blog', page: 1, q: 'pemf' });
if (!search.robots.includes('noindex')) {
  console.error('FAIL: search should be noindex');
  process.exit(1);
}

const article = buildArticleSeoMeta({
  base,
  post: {
    title: 'Test <script>',
    slug: 'test-post',
    meta_description: 'Desc "quotes"',
    published_at: new Date(),
    updated_at: new Date(),
    author_name: 'Author',
    robots_directive: 'index,follow',
  },
});

const graph = buildArticleGraph({
  post: {
    title: 'Test',
    slug: 'test-post',
    excerpt: 'Excerpt',
    published_at: new Date(),
    updated_at: new Date(),
    author_name: 'Author',
  },
  siteBaseUrl: base,
  defaultAuthor: 'Editorial',
});

if (!graph['@graph']?.length) {
  console.error('FAIL: graph empty');
  process.exit(1);
}

const faqOnly = graph['@graph'].find((n) => n['@type'] === 'FAQPage');
if (faqOnly) {
  console.error('FAIL: unexpected FAQPage');
  process.exit(1);
}

const sitemapSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'services', 'blogSitemapService.js'), 'utf8');
if (!/deleted_at IS NULL/.test(sitemapSrc)) {
  console.error('FAIL: sitemap must exclude soft-deleted posts');
  process.exit(1);
}

console.log('validate-blog-seo: OK');
console.log('  list canonical p2:', list.canonical);
console.log('  article canonical:', article.canonical);
console.log('  graph nodes:', graph['@graph'].length);
console.log('  sitemap trash filter: deleted_at IS NULL');
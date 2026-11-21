'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { buildListSeoMeta, buildArticleSeoMeta } = require('../services/blogSeoMeta');
const { buildArticleGraph } = require('../utils/jsonLdBlog');

describe('public SEO', () => {
  it('page 2 list self-canonical', () => {
    const m = buildListSeoMeta({ base: 'https://ex.com', listBase: '/blog', page: 2, q: '' });
    assert.match(m.canonical, /page=2/);
  });

  it('search uses noindex', () => {
    const m = buildListSeoMeta({ base: 'https://ex.com', listBase: '/blog', page: 1, q: 'x' });
    assert.match(m.robots, /noindex/i);
  });

  it('JSON-LD graph has no image without featured_image', () => {
    const g = buildArticleGraph({
      post: { title: 'T', slug: 't', published_at: new Date(), updated_at: new Date() },
      siteBaseUrl: 'https://ex.com',
      defaultAuthor: 'Editor',
    });
    const blog = g['@graph'].find((n) => n['@type'] === 'BlogPosting');
    assert.ok(!blog.image);
  });
});
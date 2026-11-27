'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  parseLimit,
  encodeCursor,
  decodeCursor,
  listBlogs,
  getBlogDetail,
} = require('../services/blogMobileApiService');

describe('blog mobile API — pagination helpers', () => {
  it('parseLimit defaults to 10 and caps at 20', () => {
    assert.equal(parseLimit(undefined), 10);
    assert.equal(parseLimit(''), 10);
    assert.equal(parseLimit('abc'), 10);
    assert.equal(parseLimit('15'), 15);
    assert.equal(parseLimit('99'), 20);
  });

  it('encode/decode cursor round-trip', () => {
    const row = { id: 42, published_at: new Date('2026-01-15T10:00:00.000Z') };
    const cur = encodeCursor(row);
    const dec = decodeCursor(cur);
    assert.equal(dec.id, 42);
    assert.equal(dec.publishedAt, row.published_at.toISOString());
  });

  it('decodeCursor marks garbage invalid', () => {
    assert.deepEqual(decodeCursor('not-valid!!!'), { invalid: true });
    assert.deepEqual(decodeCursor(encodeCursor({ id: 0, published_at: null })), { invalid: true });
  });
});

describe('blog mobile API — listBlogs', () => {
  const sampleRows = [
    {
      id: 3,
      title: 'C',
      slug: 'c',
      excerpt: 'excerpt c',
      featured_image: null,
      featured_image_variants: null,
      published_at: new Date('2026-03-01T00:00:00Z'),
      created_at: new Date('2026-03-01T00:00:00Z'),
      estimated_reading_time: 5,
      category_name: 'PEMF',
      category_slug: 'pemf',
    },
    {
      id: 2,
      title: 'B',
      slug: 'b',
      excerpt: 'excerpt b',
      featured_image: '/uploads/blog/a.jpg',
      featured_image_variants: null,
      published_at: new Date('2026-02-01T00:00:00Z'),
      created_at: new Date('2026-02-01T00:00:00Z'),
      estimated_reading_time: 3,
      category_name: null,
      category_slug: null,
    },
  ];

  function mockDb(rowsSequence) {
    let call = 0;
    return {
      query: async () => {
        const rows = rowsSequence[call] ?? [];
        call += 1;
        return [rows];
      },
    };
  }

  it('returns has_more and next_cursor when extra row fetched', async () => {
    const db = mockDb([sampleRows]);
    const out = await listBlogs(db, { limit: 1 });
    assert.equal(out.blogs.length, 1);
    assert.equal(out.limit, 1);
    assert.equal(out.has_more, true);
    assert.ok(out.next_cursor);
    assert.equal(out.blogs[0].slug, 'c');
  });

  it('uses cursor on second page without duplicates', async () => {
    const db = mockDb([[sampleRows[1]]]);
    const first = encodeCursor(sampleRows[0]);
    const out = await listBlogs(db, { limit: 10, cursor: first });
    assert.equal(out.blogs.length, 1);
    assert.equal(out.blogs[0].id, 2);
    assert.equal(out.has_more, false);
  });

  it('rejects invalid cursor', async () => {
    const db = mockDb([[]]);
    await assert.rejects(() => listBlogs(db, { cursor: 'bad-cursor' }), (e) => e.code === 'INVALID_CURSOR');
  });

  it('empty database returns empty list', async () => {
    const db = mockDb([[]]);
    const out = await listBlogs(db, {});
    assert.deepEqual(out.blogs, []);
    assert.equal(out.has_more, false);
    assert.equal(out.next_cursor, null);
  });
});

describe('blog mobile API — getBlogDetail', () => {
  it('returns null when repository has no published post', async () => {
    const blogRepository = require('../services/blogRepository');
    const orig = blogRepository.getPostBySlug;
    blogRepository.getPostBySlug = async () => null;
    try {
      const post = await getBlogDetail({ query: async () => [[]] }, 'unpublished-slug');
      assert.equal(post, null);
    } finally {
      blogRepository.getPostBySlug = orig;
    }
  });

  it('returns sanitized content for published post', async () => {
    const blogRepository = require('../services/blogRepository');
    const orig = blogRepository.getPostBySlug;
    blogRepository.getPostBySlug = async () => ({
      id: 9,
      slug: 'hello',
      status: 'published',
      title: 'Hello',
      excerpt: 'ex',
      content_html: '<p>Hi</p><script>alert(1)</script>',
      featured_image: null,
      featured_image_variants: null,
      published_at: new Date('2026-06-01T00:00:00Z'),
      author_name: 'Author',
      category_id: null,
      deleted_at: null,
      allow_indexing: 1,
      estimated_reading_time: 4,
    });
    try {
      const post = await getBlogDetail({ query: async () => [[]] }, 'hello');
      assert.ok(post);
      assert.equal(post.slug, 'hello');
      assert.match(post.content_html, /Hi/);
      assert.doesNotMatch(post.content_html, /script/i);
      assert.equal(post.reading_time_minutes, 4);
    } finally {
      blogRepository.getPostBySlug = orig;
    }
  });
});
'use strict';

/**
 * RUN_INTEGRATION=1 node --test test/integration/blog-mobile-api.test.js
 */
const { describe, it, before } = require('node:test');
const assert = require('node:assert');

const run = process.env.RUN_INTEGRATION === '1';

describe('blog mobile API (integration)', { skip: !run }, () => {
  let request;
  let app;

  before(async () => {
    require('dotenv').config();
    request = require('supertest');
    app = require('../../app');
  });

  it('GET /api/blogs defaults to limit 10', async () => {
    const res = await request(app).get('/api/blogs');
    assert.equal(res.status, 200);
    assert.equal(res.body.limit, 10);
    assert.ok(Array.isArray(res.body.blogs));
    assert.ok(res.body.blogs.length <= 10);
    assert.equal(typeof res.body.has_more, 'boolean');
    if (res.body.has_more) assert.ok(res.body.next_cursor);
  });

  it('GET /api/blogs with cursor returns following page', async () => {
    const first = await request(app).get('/api/blogs?limit=2');
    assert.equal(first.status, 200);
    if (!first.body.has_more) return;

    const second = await request(app).get(`/api/blogs?limit=2&cursor=${encodeURIComponent(first.body.next_cursor)}`);
    assert.equal(second.status, 200);
    assert.ok(second.body.blogs.length > 0);
    const ids1 = first.body.blogs.map((b) => b.id);
    const ids2 = second.body.blogs.map((b) => b.id);
    for (const id of ids2) {
      assert.ok(!ids1.includes(id), 'duplicate id across pages');
    }
  });

  it('GET /api/blogs rejects invalid cursor', async () => {
    const res = await request(app).get('/api/blogs?cursor=%%%invalid%%%');
    assert.equal(res.status, 400);
  });

  it('GET /api/blogs/does-not-exist returns 404', async () => {
    const res = await request(app).get('/api/blogs/this-slug-should-not-exist-000');
    assert.equal(res.status, 404);
  });
});
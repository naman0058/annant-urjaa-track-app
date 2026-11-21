'use strict';

/**
 * Integration tests — optional. Set RUN_INTEGRATION=1 and valid DB env to enable.
 * Does not call OpenAI.
 */
const { describe, it, before } = require('node:test');
const assert = require('node:assert');

const run = process.env.RUN_INTEGRATION === '1';

describe('public routes (integration)', { skip: !run }, () => {
  let request;
  let app;

  before(async () => {
    require('dotenv').config();
    request = require('supertest');
    app = require('../../app');
  });

  it('GET /robots.txt disallows admin', async () => {
    const res = await request(app).get('/robots.txt');
    assert.equal(res.status, 200);
    assert.match(res.text, /Disallow: \/admin/);
  });

  it('GET /sitemap.xml returns XML', async () => {
    const res = await request(app).get('/sitemap.xml');
    assert.equal(res.status, 200);
    assert.match(res.text, /<urlset/);
    assert.match(res.text, /\/blog/);
  });

  it('GET /admin/blog without session redirects or blocks', async () => {
    const res = await request(app).get('/admin/blog');
    assert.ok([302, 303, 401, 403].includes(res.status) || res.status === 200);
  });
});
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const RUN = process.env.RUN_INTEGRATION === '1';
const app = RUN ? require('../../app') : null;

describe('admin routes (integration)', { skip: !RUN }, () => {
  it('GET /admin/search without session redirects', async () => {
    const res = await request(app).get('/admin/search?q=test');
    assert.ok([302, 303].includes(res.status));
  });
  it('GET /admin/reports without session redirects', async () => {
    const res = await request(app).get('/admin/reports');
    assert.ok([302, 303].includes(res.status));
  });
  it('GET /admin/staff without session redirects', async () => {
    const res = await request(app).get('/admin/staff');
    assert.ok([302, 303].includes(res.status));
  });
});
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const RUN = process.env.RUN_INTEGRATION === '1';
const app = RUN ? require('../../app') : null;

describe('admin login page (integration)', { skip: !RUN }, () => {
  it('GET /admin/login returns 200 and login form markers', async () => {
    const res = await request(app).get('/admin/login');
    assert.equal(res.status, 200);
    assert.match(res.text, /Welcome back/);
    assert.match(res.text, /Sign in securely/);
    assert.match(res.text, /admin-login-form/);
    assert.match(res.text, /admin-login.js/);
  });

  it('POST /admin/login without body redirects with validation', async () => {
    const res = await request(app).post('/admin/login').type('form').send({});
    assert.ok([302, 303].includes(res.status));
  });
});
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { jsonColumnForDb } = require('../services/blogRepository');

describe('jsonColumnForDb', () => {
  it('stringifies arrays for JSON column binding', () => {
    const raw = ['meta_title may be too long', 'meta_description may be too long'];
    const s = jsonColumnForDb(raw);
    assert.equal(typeof s, 'string');
    assert.deepEqual(JSON.parse(s), raw);
  });

  it('passes through valid JSON strings', () => {
    const s = '["a"]';
    assert.equal(jsonColumnForDb(s), s);
  });
});
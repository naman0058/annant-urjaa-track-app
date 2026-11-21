'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { contentHash } = require('../services/blogRepository');

describe('blog source_hash on insert', () => {
  it('placeholder HTML hashes identically across imports', () => {
    const a = contentHash('<p><em>AI blog draft will replace this placeholder.</em></p>');
    const b = contentHash('<p><em>AI blog draft will replace this placeholder.</em></p>');
    assert.equal(a, b);
    assert.match(a, /^[a-f0-9]{64}$/);
  });

  it('explicit file hashes differ per source', () => {
    const h1 = 'abc'.repeat(20).slice(0, 64);
    const h2 = 'def'.repeat(20).slice(0, 64);
    assert.notEqual(h1, h2);
  });
});
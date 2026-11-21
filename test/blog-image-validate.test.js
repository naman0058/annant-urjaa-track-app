'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { validateUpload } = require('../services/blogFeaturedImageService');

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

describe('thumbnail upload validation', () => {
  it('accepts valid PNG signature', () => {
    const r = validateUpload({ buffer: tinyPng, mimetype: 'image/png', originalname: 'x.png' });
    assert.equal(r.type, 'png');
  });

  it('rejects executable masquerading as image', () => {
    const buf = Buffer.from('MZ' + '\x00'.repeat(100));
    assert.throws(() => validateUpload({ buffer: buf, mimetype: 'image/jpeg', originalname: 'a.jpg' }), /signature|blocked|not allowed/i);
  });

  it('rejects path tricks in filename', () => {
    assert.throws(
      () => validateUpload({ buffer: tinyPng, mimetype: 'image/png', originalname: '../../evil.png' }),
      /filename/i
    );
  });
});
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { sanitizeBlogHtml } = require('../utils/sanitizeBlogHtml');

describe('sanitizeBlogHtml (storage)', () => {
  it('strips script tags and event handlers', () => {
    const raw = '<p onclick="alert(1)">Hi</p><script>alert(1)</script>';
    const out = sanitizeBlogHtml(raw);
    assert.ok(!out.includes('<script'));
    assert.ok(!out.includes('onclick'));
    assert.ok(out.includes('<p>Hi</p>'));
  });

  it('allows safe upload images and drops javascript src', () => {
    const ok = sanitizeBlogHtml('<img src="/uploads/blog/x.jpg" alt="a">');
    assert.match(ok, /src="\/uploads\/blog\/x.jpg"/);
    const bad = sanitizeBlogHtml('<img src="javascript:alert(1)">');
    assert.ok(!bad.includes('javascript'));
  });
});
'use strict';

const fs = require('fs');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('blog sitemap excludes trashed posts', () => {
  it('listIndexablePosts SQL filters deleted_at', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'services', 'blogSitemapService.js'),
      'utf8'
    );
    assert.match(src, /deleted_at IS NULL/);
    assert.match(src, /status = 'published'/);
  });
});
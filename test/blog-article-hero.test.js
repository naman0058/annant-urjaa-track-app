'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { buildArticleHeroImage, extractFirstImageSrc } = require('../utils/blogImageView');

describe('buildArticleHeroImage', () => {
  it('uses branded default when no images exist', () => {
    const hero = buildArticleHeroImage({
      featured: null,
      variants: null,
      ogImage: null,
      contentHtml: '<p>Hello</p>',
      siteBase: '',
    });
    assert.equal(hero.isPlaceholder, true);
    assert.match(hero.src, /\/images\//);
  });

  it('extracts first inline image', () => {
    const src = extractFirstImageSrc('<p>x</p><img src="/uploads/blog/a.webp" alt="">');
    assert.equal(src, '/uploads/blog/a.webp');
    const hero = buildArticleHeroImage({
      featured: null,
      contentHtml: '<img src="/uploads/blog/a.webp">',
      siteBase: '',
    });
    assert.equal(hero.isPlaceholder, false);
    assert.equal(hero.src, '/uploads/blog/a.webp');
  });
});
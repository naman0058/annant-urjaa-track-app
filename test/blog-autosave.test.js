'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

/**
 * Exercises autosave field mapping via the same rules as routes/admin/blog.js
 * without requiring a live database.
 */
function autosavePayloadToPostFields(body) {
  const title = String(body.title || '').trim() || 'Untitled draft';
  const parseCategoryId = (b) => {
    const n = parseInt(b.category_id, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const parseScheduledAt = (input) => {
    if (!input) return null;
    const d = new Date(input);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  return {
    title,
    slug: body.slug,
    excerpt: body.excerpt,
    content_html: body.content_html,
    status: ['draft', 'review', 'scheduled', 'archived'].includes(body.status) ? body.status : 'draft',
    category_id: parseCategoryId(body),
    scheduled_at: parseScheduledAt(body.scheduled_at),
  };
}

describe('blog autosave payload', () => {
  it('uses Untitled draft when title empty', () => {
    const f = autosavePayloadToPostFields({ content_html: '<p>x</p>' });
    assert.equal(f.title, 'Untitled draft');
    assert.equal(f.status, 'draft');
  });

  it('preserves title and content on partial update shape', () => {
    const f = autosavePayloadToPostFields({
      title: 'Hello',
      slug: 'hello',
      content_html: '<p>Hi</p>',
      status: 'review',
    });
    assert.equal(f.title, 'Hello');
    assert.equal(f.slug, 'hello');
    assert.equal(f.status, 'review');
    assert.match(f.content_html, /Hi/);
  });
});
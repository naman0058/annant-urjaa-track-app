'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { parseArticleOutput } = require('../services/ai/articleOutputSchema');
const mockArticle = require('./fixtures/mockOpenAiArticle');

describe('AI structured output validation', () => {
  it('accepts mock OpenAI article', () => {
    const r = parseArticleOutput(mockArticle, 'full');
    assert.equal(r.success, true);
    assert.ok(r.data.title);
  });

  it('rejects empty parse', () => {
    const r = parseArticleOutput({ title: '' }, 'full');
    assert.equal(r.success, false);
  });

  it('metadata-only mode allows null content_html', () => {
    const r = parseArticleOutput(
      { ...mockArticle, content_html: null, title: 'Valid Title' },
      'metadata'
    );
    assert.equal(r.success, true);
  });
});
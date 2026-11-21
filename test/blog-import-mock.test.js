'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const mockArticle = require('./fixtures/mockOpenAiArticle');
const { parseArticleOutput } = require('../services/ai/articleOutputSchema');

describe('mock OpenAI article fixture (no API)', () => {
  it('passes Zod validation for full mode', () => {
    const parsed = parseArticleOutput(mockArticle, 'full');
    assert.equal(parsed.success, true);
    assert.equal(parsed.data.title, mockArticle.title);
    assert.ok(parsed.data.content_html.includes('<p>'));
  });

  it('suggested tags are strings', () => {
    const parsed = parseArticleOutput(mockArticle, 'full');
    assert.ok(Array.isArray(parsed.data.suggested_tags));
    assert.equal(typeof parsed.data.suggested_tags[0], 'string');
  });
});
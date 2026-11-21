'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { getImportRewriteUserDirective, getTitleAnchorDirective } = require('../services/import/importMode');

describe('import rewrite directives', () => {
  it('ai_rewrite forbids reusing source headings', () => {
    const d = getImportRewriteUserDirective('ai_rewrite');
    assert.match(d, /copyright/i);
    assert.match(d, /TITLE/i);
    assert.match(d, /h2/i);
    assert.match(d, /Do NOT reuse/i);
  });

  it('title anchor keeps legacy title', () => {
    const d = getTitleAnchorDirective('PEMF Therapy Basics');
    assert.match(d, /PEMF Therapy Basics/);
    assert.match(d, /Title anchor/i);
  });

  it('preserve_format keeps headings', () => {
    const d = getImportRewriteUserDirective('preserve_format');
    assert.match(d, /heading text close to the source/i);
  });

  it('metadata_only adds no import block', () => {
    assert.equal(getImportRewriteUserDirective('metadata_only'), '');
  });
});
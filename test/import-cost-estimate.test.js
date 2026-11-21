'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { heuristicPlainChars } = require('../services/import/tokenEstimate');
const { estimateForFiles } = require('../services/import/costEstimate');

describe('import cost estimate', () => {
  it('docx heuristic uses much smaller chars than raw binary size', () => {
    const entry = { relativePath: 'a.docx', size: 500_000, ext: '.docx' };
    const chars = heuristicPlainChars(entry);
    assert.ok(chars < 50_000);
    assert.ok(chars < entry.size / 4);
  });

  it('estimate returns separate input and output tokens', () => {
    const est = estimateForFiles(
      [{ relativePath: 'a.txt', estimatedChars: 4000 }],
      'gpt-4o-mini'
    );
    assert.ok(est.inputTokens > 0);
    assert.ok(est.outputTokens > 0);
    assert.equal(est.totalTokens, est.inputTokens + est.outputTokens);
    assert.ok(est.estimatedCostUsd >= 0);
  });
});
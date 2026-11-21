'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { resolveEligibleEntries, normalizeJobConfig } = require('../services/import/folderImportService');

describe('import selection rules', () => {
  const scan = {
    entries: [
      { relativePath: 'a.md', status: 'supported' },
      { relativePath: 'b.md', status: 'supported', alreadyImported: true },
      { relativePath: 'c.pdf', status: 'unsupported' },
    ],
  };

  it('excludes already imported from eligible set', () => {
    const rows = resolveEligibleEntries(scan, ['a.md', 'b.md']);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].relativePath, 'a.md');
  });

  it('returns empty when nothing eligible', () => {
    assert.equal(resolveEligibleEntries(scan, ['b.md']).length, 0);
  });

  it('normalizeJobConfig stores auto_publish from body', () => {
    assert.equal(normalizeJobConfig({ auto_publish: '1' }).auto_publish, true);
    assert.equal(normalizeJobConfig({ auto_publish: '0' }).auto_publish, false);
  });
});
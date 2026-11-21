'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { filterEntries } = require('../services/import/scanSnapshot');

describe('import scan eligibility', () => {
  const entries = [
    { relativePath: 'a.md', status: 'supported', alreadyImported: false },
    { relativePath: 'b.md', status: 'supported', alreadyImported: true },
    { relativePath: 'c.pdf', status: 'unsupported' },
  ];

  it('alreadyImported=0 excludes prior imports', () => {
    const rows = filterEntries(entries, { status: 'supported', alreadyImported: '0' });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].relativePath, 'a.md');
  });
});
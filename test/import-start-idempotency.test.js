'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { findJobByClientRequest } = require('../services/import/folderImportRepository');

describe('import start idempotency helper', () => {
  it('findJobByClientRequest returns null when no match', async () => {
    const db = {
      query: async () => [[]],
    };
    const row = await findJobByClientRequest(db, 1, 'req-abc');
    assert.equal(row, null);
  });

  it('findJobByClientRequest returns row when present', async () => {
    const db = {
      query: async () => [[{ id: 9, job_key: 'k', total_files: 3 }]],
    };
    const row = await findJobByClientRequest(db, 1, 'req-abc');
    assert.equal(row.id, 9);
  });
});
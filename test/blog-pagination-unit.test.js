'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { resolvePagination } = require('../utils/blogPagination');

describe('pagination', () => {
  it('flags invalid page beyond total', () => {
    const r = resolvePagination({ pageRaw: 99, total: 10 });
    assert.equal(r.invalidPage, true);
    assert.equal(r.limit, 9);
  });

  it('defaults to page 1', () => {
    const r = resolvePagination({ pageRaw: 'abc', total: 100 });
    assert.equal(r.page, 1);
  });
});
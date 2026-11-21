'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseTagInput } = require('../services/blogTagService');

describe('blogTagService.parseTagInput', () => {
  it('splits comma-separated tags', () => {
    assert.deepEqual(parseTagInput('a, b ,c'), ['a', 'b', 'c']);
  });

  it('accepts arrays', () => {
    assert.deepEqual(parseTagInput(['x', ' y ']), ['x', 'y']);
  });

  it('returns empty for blank', () => {
    assert.deepEqual(parseTagInput(''), []);
    assert.deepEqual(parseTagInput(null), []);
  });
});
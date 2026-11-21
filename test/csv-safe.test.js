'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { csvEscape, csvRow } = require('../utils/csvSafe');

describe('csvSafe', () => {
  it('prefixes formula-like values', () => {
    assert.equal(csvEscape('=1+1'), "'=1+1");
  });

  it('quotes fields with commas', () => {
    assert.equal(csvRow(['a', 'b,c']).includes('"b,c"'), true);
  });
});
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { formatPeriodDelta } = require('../utils/adminDelta');

describe('formatPeriodDelta', () => {
  it('shows New when prior is zero', () => {
    const d = formatPeriodDelta(5, 0);
    assert.equal(d.label, 'New');
  });
  it('shows em dash when both zero', () => {
    assert.equal(formatPeriodDelta(0, 0).label, '—');
  });
  it('computes percent when prior exists', () => {
    assert.equal(formatPeriodDelta(150, 100).label, '+50% vs prior');
  });
});
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { mergePeriodBreakdown, normalizeTab } = require('../services/adminReportsService');
const { buildCompareRange } = require('../services/adminReportingCore');

describe('adminReportsService', () => {
  it('normalizeTab falls back to overview', () => {
    assert.equal(normalizeTab('bogus'), 'overview');
    assert.equal(normalizeTab('revenue'), 'revenue');
  });

  it('mergePeriodBreakdown aligns series by period', () => {
    const rows = mergePeriodBreakdown(
      [{ x: '2026-01-01', y: 100 }],
      [{ x: '2026-01-01', y: 2 }],
      [{ x: '2026-01-02', y: 1 }],
      [{ x: '2026-01-01', cnt: 3, y: 3 }]
    );
    const day1 = rows.find((r) => r.period === '2026-01-01');
    assert.equal(day1.revenue_paise, 100);
    assert.equal(day1.subscriptions, 2);
    assert.equal(day1.transactions, 3);
  });
});

describe('buildCompareRange', () => {
  it('previous year shifts dates', () => {
    const r = buildCompareRange('prev_year', '2026-11-01', '2026-11-20', 20);
    assert.equal(r.from, '2025-11-01');
    assert.equal(r.to, '2025-11-20');
  });
});
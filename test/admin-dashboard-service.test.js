'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseDateRange,
  aggregateSeriesRows,
  enumerateDays,
  resolveGranularity,
  sumSeriesAmount,
} = require('../services/adminDashboardService');

describe('adminDashboardService', () => {
  it('parseDateRange defaults to 30d window', () => {
    const r = parseDateRange({});
    assert.equal(r.preset, '30d');
    assert.ok(r.from && r.to);
    assert.ok(r.days >= 29 && r.days <= 31);
  });

  it('parseDateRange: today preset ignores stale from/to in query', () => {
    const r = parseDateRange({
      preset: 'today',
      from: '2023-11-30',
      to: '2026-11-20',
    });
    assert.equal(r.preset, 'today');
    assert.equal(r.from, r.to);
    assert.equal(r.days, 1);
  });

  it('parseDateRange supports custom range', () => {
    const r = parseDateRange({
      preset: 'custom',
      from: '2023-11-30',
      to: '2026-11-20',
    });
    assert.equal(r.preset, 'custom');
    assert.equal(r.from, '2023-11-30');
    assert.equal(r.to, '2026-11-20');
    assert.ok(r.days > 1000);
  });

  it('resolveGranularity auto monthly beyond 180 days', () => {
    const r = resolveGranularity({}, 400);
    assert.equal(r.granularity, 'monthly');
    assert.equal(r.auto, true);
  });

  it('resolveGranularity respects user override with granularity_set', () => {
    const r = resolveGranularity({ granularity: 'daily', granularity_set: '1' }, 400);
    assert.equal(r.granularity, 'daily');
    assert.equal(r.auto, false);
  });

  it('resolveGranularity weekly between 32 and 180 days', () => {
    const r = resolveGranularity({}, 90);
    assert.equal(r.granularity, 'weekly');
  });

  it('aggregateSeriesRows fills missing buckets with zero', () => {
    const days = enumerateDays('2026-11-18', '2026-11-20');
    const rows = [{ x: '2026-11-19', y: 50000, cnt: 2 }];
    const out = aggregateSeriesRows(rows, '2026-11-18', '2026-11-20', 'daily');
    assert.equal(out.length, days.length);
    const mid = out.find((row) => row.x === '2026-11-19');
    assert.equal(mid.y, 50000);
    assert.equal(sumSeriesAmount(out), 50000);
  });

  it('aggregateSeriesRows reconciles sum with KPI-style total', () => {
    const rows = [
      { x: '2026-01-01', y: 10000, cnt: 1 },
      { x: '2026-01-15', y: 28900, cnt: 2 },
    ];
    const out = aggregateSeriesRows(rows, '2026-01-01', '2026-01-31', 'daily');
    assert.equal(sumSeriesAmount(out), 38900);
  });

  it('monthly aggregation uses month buckets for multi-year range', () => {
    const rows = [{ x: '2024-06-15', y: 1200, cnt: 1 }];
    const out = aggregateSeriesRows(rows, '2023-11-30', '2026-01-15', 'monthly');
    assert.ok(out.length < 50);
    const june = out.find((b) => b.x === '2024-06');
    assert.equal(june.y, 1200);
  });
});
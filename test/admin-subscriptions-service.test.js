'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSubscriptionWhere,
  countActiveFilters,
  validateDateRange,
  validateStatusTransition,
  validateActiveGrant,
  parseListQuery,
} = require('../services/adminSubscriptionsService');

describe('adminSubscriptionsService', () => {
  it('parseListQuery defaults and caps limit', () => {
    const q = parseListQuery({ page: '2', limit: '500', sort: 'status', dir: 'asc' });
    assert.equal(q.page, 2);
    assert.equal(q.limit, 100);
    assert.equal(q.dir, 'ASC');
    assert.equal(q.filters.dir, 'asc');
    assert.equal(q.filters.sort, 'status');
  });

  it('buildSubscriptionWhere applies status and joins track when track_id mode', () => {
    const { whereSql, params, joinTrack } = buildSubscriptionWhere(
      { status: 'active', q: 'alice' },
      { hasTrackId: true }
    );
    assert.match(whereSql, /s\.status = :status/);
    assert.equal(params.status, 'active');
    assert.match(joinTrack, /tracks t/);
    assert.match(whereSql, /t\.title LIKE/);
  });

  it('countActiveFilters ignores sort and limit', () => {
    const n = countActiveFilters({ status: 'active', sort: 'created_at', limit: 20 });
    assert.equal(n, 1);
  });

  it('validateDateRange rejects inverted range', () => {
    assert.equal(validateDateRange('2026-02-01', '2026-01-01').ok, false);
    assert.equal(validateDateRange('2026-01-01', '2026-02-01').ok, true);
  });

  it('validateStatusTransition allows re-activate without grant reason', () => {
    assert.equal(validateStatusTransition('cancelled', 'active', { grantReason: '' }).ok, true);
    assert.equal(validateStatusTransition('expired', 'active', {}).ok, true);
  });

  it('validateActiveGrant allows active without reason', () => {
    assert.equal(validateActiveGrant('active', '', 'manager').ok, true);
    assert.equal(validateActiveGrant('expired', '', 'manager').ok, true);
  });
});
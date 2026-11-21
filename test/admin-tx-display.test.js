'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { formatTxStatus, shortOrderId, formatTxDate, formatTxDateTime } = require('../utils/adminTxDisplay');

describe('adminTxDisplay', () => {
  it('maps in_transit to readable label', () => {
    assert.equal(formatTxStatus('in_transit'), 'In transit');
  });

  it('shortens long order ids', () => {
    const s = shortOrderId('order_ABC123XYZ987654');
    assert.ok(s.includes('…'));
    assert.ok(s.length < 20);
  });

  it('formatTxDate omits time', () => {
    const day = formatTxDate('2026-08-21T16:53:00.000Z', 'Asia/Kolkata');
    assert.match(day, /21/);
    assert.doesNotMatch(day, /pm|am|:/);
    assert.notEqual(formatTxDateTime('2026-08-21T16:53:00.000Z', 'Asia/Kolkata'), day);
  });
});
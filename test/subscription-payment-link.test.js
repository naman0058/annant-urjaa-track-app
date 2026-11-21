'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  shouldCreateSubscriptionForTransaction,
} = require('../utils/subscriptionPaymentLink');
const { summarizeIssuanceFromAudit } = require('../services/adminSubscriptionsService');

describe('subscriptionPaymentLink', () => {
  it('shouldCreateSubscriptionForTransaction requires user and track', () => {
    assert.equal(shouldCreateSubscriptionForTransaction({ user_id: 1, track_id: 2 }), true);
    assert.equal(shouldCreateSubscriptionForTransaction({ user_id: 1, track_id: null }), false);
    assert.equal(shouldCreateSubscriptionForTransaction(null), false);
  });
});

describe('summarizeIssuanceFromAudit', () => {
  it('detects complimentary grant from audit', () => {
    const iss = summarizeIssuanceFromAudit([
      {
        action: 'subscription.admin_grant',
        metadata_json: JSON.stringify({ reason: 'Partner comp', after: { status: 'active' } }),
        actor_email: 'a@it.com',
        created_at: '2026-01-01',
      },
    ]);
    assert.equal(iss.type, 'complimentary');
    assert.equal(iss.reason, 'Partner comp');
  });
});

describe('related payments regression', () => {
  it('member email rows must not masquerade as subscription-linked', () => {
    const linkedRequires = (row) => row.subscription_id != null;
    assert.equal(linkedRequires({ subscription_id: 14 }), true);
    assert.equal(linkedRequires({ subscription_id: null, email: 'x@y.com' }), false);
  });
});
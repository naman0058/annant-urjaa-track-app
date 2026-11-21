'use strict';

const crypto = require('crypto');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

function razorpayExpectedSignature(secret, body) {
  const payload = JSON.stringify(body);
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

describe('Razorpay webhook HMAC', () => {
  it('matches signature for canonical JSON payload', () => {
    const secret = 'test_webhook_secret';
    const body = { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1' } } } };
    const sig = razorpayExpectedSignature(secret, body);
    assert.equal(sig, razorpayExpectedSignature(secret, body));
    assert.notEqual(sig, razorpayExpectedSignature('wrong', body));
  });
});
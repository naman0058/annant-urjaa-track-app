'use strict';

const { tableHasColumn } = require('../services/adminReportingCore');

/**
 * After a verified capture + subscription upsert in the same DB transaction,
 * link only this order's transaction row to the subscription row that was
 * created/updated for the same user_id + track_id.
 */
async function linkCapturedPaymentToSubscription(db, { orderId, userId, trackId }) {
  if (!orderId || !userId || !trackId) {
    return { linked: false, reason: 'missing_order_user_or_track' };
  }
  const hasCol = await tableHasColumn(db, 'transactions', 'subscription_id');
  if (!hasCol) return { linked: false, reason: 'no_subscription_id_column' };

  const [subs] = await db.query(
    `SELECT id FROM subscriptions
     WHERE user_id = :user_id AND track_id = :track_id
     ORDER BY id DESC LIMIT 1`,
    { user_id: Number(userId), track_id: trackId }
  );
  const subId = subs[0]?.id;
  if (!subId) return { linked: false, reason: 'subscription_not_found' };

  const [result] = await db.query(
    `UPDATE transactions
     SET subscription_id = :sub_id
     WHERE order_id = :order_id
       AND user_id = :user_id
       AND (subscription_id IS NULL OR subscription_id = :sub_id)`,
    { sub_id: subId, order_id: orderId, user_id: Number(userId) }
  );
  return {
    linked: (result.affectedRows || 0) > 0,
    subscriptionId: subId,
    reason: result.affectedRows ? 'linked' : 'already_linked_or_missing_row',
  };
}

function shouldCreateSubscriptionForTransaction(txRow) {
  if (!txRow) return false;
  const trackId = txRow.track_id;
  if (trackId == null || trackId === '') return false;
  const userId = Number(txRow.user_id);
  if (!Number.isInteger(userId) || userId <= 0) return false;
  return true;
}

module.exports = { linkCapturedPaymentToSubscription, shouldCreateSubscriptionForTransaction };
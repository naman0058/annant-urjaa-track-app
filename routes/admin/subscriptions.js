'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');
const { requireAuth, requireRole } = require('../../middleware/adminAuth');
const { logAdminAudit } = require('../../services/adminAuditService');
const {
  STATUSES,
  listSubscriptions,
  listSubscriptionsForExport,
  lookupTracks,
  getSubscriptionById,
  createSubscription,
  updateSubscription,
  cancelSubscription,
  deleteSubscription,
  listSubscriptionAudit,
  summarizeIssuanceFromAudit,
  getLinkedPayments,
  getMemberTransactionHistory,
  statusBadgeClass,
  formatStatusLabel,
  getTrackMode,
} = require('../../services/adminSubscriptionsService');
const { csvRow, csvWithBom } = require('../../utils/csvSafe');
const txDisplay = require('../../utils/adminTxDisplay');

const router = express.Router();

function buildListQueryString(filters, extra = {}) {
  const p = new URLSearchParams();
  const f = filters || {};
  const keys = [
    'q',
    'status',
    'track',
    'user_id',
    'from',
    'to',
    'start_from',
    'start_to',
    'end_from',
    'end_to',
    'sort',
    'dir',
    'limit',
  ];
  keys.forEach((k) => {
    if (f[k]) p.set(k, f[k]);
  });
  Object.keys(extra).forEach((k) => p.set(k, extra[k]));
  const s = p.toString();
  return s ? `?${s}` : '';
}

router.get('/subscriptions', requireAuth, async (req, res) => {
  try {
    const payload = await listSubscriptions(req.db, req.query);
    const listReturnQs = buildListQueryString(payload.filters).replace(/^\?/, '');
    res.render('subscriptions', {
      title: 'Subscriptions',
      subs: payload.rows,
      pagination: payload.pagination,
      filters: payload.filters,
      kpis: payload.kpis,
      activeFilterCount: payload.activeFilterCount,
      trackOptions: payload.trackOptions,
      hasTrackId: payload.hasTrackId,
      datasetEmpty: payload.datasetEmpty,
      listReturnQs,
      subDisplay: { statusBadgeClass, formatStatusLabel },
      qsBase: (extra) => buildListQueryString(payload.filters, extra),
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not load subscriptions.');
    res.render('subscriptions', {
      title: 'Subscriptions',
      subs: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
      filters: {},
      kpis: { activeSnapshot: 0, expiringSoon: 0, totalAll: 0 },
      activeFilterCount: 0,
      trackOptions: [],
      hasTrackId: true,
      datasetEmpty: true,
      subDisplay: { statusBadgeClass, formatStatusLabel },
      qsBase: () => '',
    });
  }
});

router.get('/subscriptions.csv', requireAuth, async (req, res) => {
  try {
    const rows = await listSubscriptionsForExport(req.db, req.query);
    const header = csvRow([
      'id',
      'user_name',
      'email',
      'track',
      'track_title',
      'status',
      'start_date',
      'end_date',
      'created_at',
    ]);
    const lines = rows.map((r) =>
      csvRow([
        r.id,
        r.user_name,
        r.email,
        r.track_key,
        r.track_title,
        r.status,
        r.start_date || '',
        r.end_date || '',
        r.created_at,
      ])
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="subscriptions.csv"');
    res.send(csvWithBom([header, ...lines]));
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to export CSV');
  }
});

router.get('/subscriptions/lookup/tracks', requireAuth, async (req, res) => {
  const q = String(req.query.q || '').trim();
  try {
    const rows = await lookupTracks(req.db, q);
    res.json({ rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ rows: [] });
  }
});

router.get('/subscriptions/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) {
    req.flash('error', 'Subscription not found');
    return res.redirect('/admin/subscriptions');
  }
  const sub = await getSubscriptionById(req.db, id);
  if (!sub) {
    req.flash('error', 'Subscription not found');
    return res.redirect('/admin/subscriptions');
  }
  const auditHistory = await listSubscriptionAudit(req.db, id);
  const linkedPayments = await getLinkedPayments(req.db, id, 5);
  const memberTxPage = Math.max(parseInt(req.query.tx_page, 10) || 1, 1);
  const memberTxHistory = await getMemberTransactionHistory(req.db, sub.user_id, sub.user_email, {
    page: memberTxPage,
    limit: 5,
  });
  const issuance = summarizeIssuanceFromAudit(auditHistory);
  const { hasTrackId } = await getTrackMode(req.db);
  const returnQs = String(req.query.return || '').trim();
  res.render('subscription-detail', {
    title: `Subscription #${id}`,
    sub,
    auditHistory,
    linkedPayments: linkedPayments.rows,
    paymentLinkage: linkedPayments.linkage,
    memberTxHistory,
    memberTxPage,
    issuance,
    hasTrackId,
    returnQs,
    subDisplay: { statusBadgeClass, formatStatusLabel },
    txDisplay,
  });
});

router.post(
  '/subscriptions',
  requireAuth,
  requireRole(['super', 'manager']),
  body('user_id').isInt({ min: 1 }),
  body('track').notEmpty(),
  body('status').isIn(STATUSES),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash('error', 'Check member, track, and status.');
      return res.redirect('/admin/subscriptions');
    }
    const adminRole = req.session.admin.role;
    const result = await createSubscription(req.db, req.body, adminRole);
    if (!result.ok) {
      req.flash('error', result.error || 'Could not create subscription');
      return res.redirect('/admin/subscriptions');
    }
    const action = result.after?.status === 'active' ? 'subscription.admin_grant' : 'subscription.create';
    await logAdminAudit(req.db, {
      adminId: req.session.admin.id,
      action,
      entityType: 'subscription',
      entityId: result.id,
        metadata: {
        after: result.after,
        reason: req.body.grant_reason || null,
        issuance_type: result.after?.status === 'active' ? 'admin' : 'standard',
      },
    });
    req.flash('success', 'Subscription created.');
    res.redirect('/admin/subscriptions');
  }
);

router.post(
  '/subscriptions/:id',
  requireAuth,
  requireRole(['super', 'manager']),
  body('status').optional().isIn(STATUSES),
  async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const adminRole = req.session.admin.role;
    const result = await updateSubscription(req.db, id, req.body, adminRole);
    if (!result.ok) {
      req.flash('error', result.error || 'Could not update subscription');
      const back = id ? `/admin/subscriptions/${id}` : '/admin/subscriptions';
      return res.redirect(back);
    }
    const action =
      result.after?.status === 'active' && result.before?.status !== 'active'
        ? 'subscription.admin_grant'
        : 'subscription.update';
    await logAdminAudit(req.db, {
      adminId: req.session.admin.id,
      action,
      entityType: 'subscription',
      entityId: id,
      metadata: {
        before: result.before,
        after: result.after,
        reason: req.body.grant_reason || null,
      },
    });
    req.flash('success', 'Subscription updated.');
    const dest = req.body._redirect === 'detail' ? `/admin/subscriptions/${id}` : '/admin/subscriptions';
    res.redirect(dest);
  }
);

router.post(
  '/subscriptions/:id/cancel',
  requireAuth,
  requireRole(['super', 'manager']),
  async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const result = await cancelSubscription(req.db, id, req.body.cancel_reason);
    if (!result.ok) {
      req.flash('error', result.error || 'Could not cancel subscription');
      return res.redirect(req.body._redirect === 'detail' ? `/admin/subscriptions/${id}` : '/admin/subscriptions');
    }
    await logAdminAudit(req.db, {
      adminId: req.session.admin.id,
      action: 'subscription.cancel',
      entityType: 'subscription',
      entityId: id,
      metadata: {
        before: result.before,
        after: result.after,
        reason: req.body.cancel_reason || null,
      },
    });
    req.flash('success', 'Subscription cancelled.');
    res.redirect(req.body._redirect === 'detail' ? `/admin/subscriptions/${id}` : '/admin/subscriptions');
  }
);

router.post('/subscriptions/:id/delete', requireAuth, requireRole(['super']), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const result = await deleteSubscription(req.db, id);
  if (!result.ok) {
    req.flash('error', result.error || 'Could not delete subscription');
    return res.redirect('/admin/subscriptions');
  }
  await logAdminAudit(req.db, {
    adminId: req.session.admin.id,
    action: 'subscription.delete',
    entityType: 'subscription',
    entityId: id,
    metadata: { before: { id: result.before?.id, status: result.before?.status } },
  });
  req.flash('success', 'Subscription deleted.');
  res.redirect('/admin/subscriptions');
});

module.exports = router;
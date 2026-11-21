'use strict';

const express = require('express');
const { requireAuth } = require('../../middleware/adminAuth');
const { loadReports, normalizeTab } = require('../../services/adminReportsService');
const { csvRow, csvWithBom } = require('../../utils/csvSafe');
const txDisplay = require('../../utils/adminTxDisplay');

const router = express.Router();

const reportViewLocals = { title: 'Reports & Analytics', txDisplay };

const emptyReportsPayload = {
  tab: 'overview',
  filters: {
    preset: '30d',
    from: '',
    to: '',
    track: '',
    sub_status: 'all',
    tx_status: 'captured',
    method: '',
    category_id: '',
    granularity: 'daily',
    compare: 'prev_period',
    tab: 'overview',
  },
  ranges: { from: '', to: '', prevFrom: '', prevTo: '', days: 30, compareLabel: '' },
  categoryOptions: [],
  trackOptions: [],
  activeFilterCount: 0,
  stats: {
    totalUsers: 0,
    subsCount: 0,
    salesAmount: 0,
    transactionCount: 0,
    refundedAmount: 0,
    deltas: {
      users: { label: '—', cssClass: 'delta--flat' },
      subs: { label: '—', cssClass: 'delta--flat' },
      sales: { label: '—', cssClass: 'delta--flat' },
      transactions: { label: '—', cssClass: 'delta--flat' },
    },
  },
  subsSeries: [],
  salesSeries: [],
  memberSeries: [],
  txStatusBreakdown: [],
  topTracks: [],
  activeTracksByTrack: [],
  revenueByTrack: [],
  revenueByTrackAvailable: false,
  subscriptionStatusInPeriod: [],
  activeSubscriptionsSnapshot: 0,
  periodBreakdown: [],
  chartMeta: {
    granularity: 'daily',
    salesTotalInSeries: 0,
    salesAmountKpi: 0,
    revenueReconciled: true,
  },
  transactionsPage: { rows: [], page: 1, pageSize: 25, total: 0, totalPages: 1 },
};

router.get('/reports', requireAuth, async (req, res) => {
  try {
    const data = await loadReports(req.db, { ...req.query, preset: req.query.preset || '30d' });
    res.render('reports', {
      ...reportViewLocals,
      ...data,
    });
  } catch (err) {
    console.error('reports', err);
    req.flash('error', 'Could not load reports.');
    res.render('reports', {
      ...reportViewLocals,
      ...emptyReportsPayload,
    });
  }
});

function filterQueryString(f) {
  const p = new URLSearchParams();
  Object.entries(f || {}).forEach(([k, v]) => {
    if (v != null && v !== '') p.set(k, String(v));
  });
  return p.toString();
}

router.get('/reports.csv', requireAuth, async (req, res) => {
  try {
    const exportType = String(req.query.export || 'summary').trim();
    const data = await loadReports(req.db, { ...req.query, preset: req.query.preset || '30d' });
    const f = data.filters || {};
    const stamp = `${f.from || 'na'}_${f.to || 'na'}`;

    if (exportType === 'breakdown') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="reports-breakdown_${stamp}.csv"`
      );
      const lines = [
        csvRow(['period', 'revenue_paise', 'transactions', 'subscriptions', 'members']),
        ...(data.periodBreakdown || []).map((r) =>
          csvRow([r.period, r.revenue_paise, r.transactions, r.subscriptions, r.members])
        ),
      ];
      return res.send(csvWithBom(lines));
    }

    if (exportType === 'transactions') {
      const full = await loadReports(req.db, {
        ...req.query,
        tab: 'transactions',
        pageSize: '10000',
        page: '1',
      });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="reports-transactions_${stamp}.csv"`
      );
      const lines = [
        csvRow(['order_id', 'email', 'amount_paise', 'status', 'method', 'created_at']),
        ...(full.transactionsPage.rows || []).map((t) =>
          csvRow([
            t.order_id,
            t.email,
            t.amount,
            t.status,
            t.method,
            t.created_at,
          ])
        ),
      ];
      return res.send(csvWithBom(lines));
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="reports-summary_${stamp}.csv"`);
    const st = data.stats || {};
    const lines = [
      csvRow(['metric', 'value']),
      csvRow(['filters', filterQueryString(f)]),
      csvRow(['captured_revenue_paise', st.salesAmount]),
      csvRow(['transaction_count', st.transactionCount]),
      csvRow(['new_subscriptions', st.subsCount]),
      csvRow(['new_members', st.totalUsers]),
      csvRow(['refunded_paise', st.refundedAmount]),
    ];
    res.send(csvWithBom(lines));
  } catch (err) {
    console.error('reports.csv', err);
    res.status(500).send('Export failed.');
  }
});

module.exports = router;
module.exports.normalizeTab = normalizeTab;
'use strict';

const express = require('express');
const { requireAuth } = require('../../middleware/adminAuth');
const { loadDashboard } = require('../../services/adminDashboardService');
const txDisplay = require('../../utils/adminTxDisplay');

const router = express.Router();
const dashboardViewLocals = { title: 'Dashboard Overview', txDisplay };

router.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const data = await loadDashboard(req.db, req.query);
    res.render('dashboard', {
      ...dashboardViewLocals,
      ...data,
    });
  } catch (err) {
    console.error('dashboard', err);
    req.flash('error', 'Could not load dashboard metrics.');
    res.render('dashboard', {
      ...dashboardViewLocals,
      filters: {
        preset: '30d',
        from: '',
        to: '',
        track: '',
        sub_status: 'all',
        tx_status: 'captured',
        granularity: 'daily',
      },
      ranges: { from: '', to: '', prevFrom: '', prevTo: '', days: 30 },
      trackOptions: [],
      activeFilterCount: 0,
      stats: {
        totalUsers: 0,
        subsCount: 0,
        salesAmount: 0,
        failedTxCount: 0,
        deltas: {
          users: { label: '—', cssClass: 'delta--flat' },
          subs: { label: '—', cssClass: 'delta--flat' },
          sales: { label: '—', cssClass: 'delta--flat' },
          failed: { label: '—', cssClass: 'delta--flat' },
        },
      },
      actionQueue: [],
      subsSeries: [],
      salesSeries: [],
      chartMeta: { granularity: 'daily', salesTotalInSeries: 0, subsTotalInSeries: 0 },
      recentTxns: [],
      topTracks: [],
    });
  }
});

module.exports = router;
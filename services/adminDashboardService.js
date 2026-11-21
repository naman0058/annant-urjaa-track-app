'use strict';

const { formatPeriodDelta } = require('../utils/adminDelta');
const core = require('./adminReportingCore');

const {
  parseDateRange,
  aggregateSeriesRows,
  sumSeriesAmount,
  countActiveFilters,
  chartGroupExpr,
  buildSubWhere,
} = core;

async function loadDashboard(db, query) {
  const range = parseDateRange({ ...query, compare: 'prev_period' });
  const {
    from,
    to,
    track,
    sub_status,
    tx_status,
    prevFrom,
    prevTo,
    preset,
    granularity,
    granularityAuto,
    granularity_set,
  } = range;

  const { subWhereSql, subParams } = buildSubWhere(range);

  const txParams = { tx_from: `${from} 00:00:00`, tx_to: `${to} 23:59:59` };
  const txParts = ['t.created_at >= :tx_from AND t.created_at <= :tx_to'];
  if (tx_status && tx_status !== 'all') {
    txParts.push('t.status = :tx_status');
    txParams.tx_status = tx_status;
  }
  const txWhereSql = `WHERE ${txParts.join(' AND ')}`;

  const failedParams = { ...txParams, failed_status: 'failed' };
  const failedWhere = `WHERE t.created_at >= :tx_from AND t.created_at <= :tx_to AND t.status = :failed_status`;
  const staleTransitWhere = `WHERE t.status = 'in_transit' AND t.created_at < DATE_SUB(NOW(), INTERVAL 48 HOUR)`;

  const subPrevParams = {
    ...subParams,
    sub_prev_from: `${prevFrom} 00:00:00`,
    sub_prev_to: `${prevTo} 23:59:59`,
  };
  const subPrevSql = `WHERE s.created_at >= :sub_prev_from AND s.created_at <= :sub_prev_to${
    track ? ' AND CAST(s.track_id AS CHAR) = :track' : ''
  }${sub_status && sub_status !== 'all' ? ' AND s.status = :sub_status' : ''}`;

  const txPrevParams = {
    ...txParams,
    tx_prev_from: `${prevFrom} 00:00:00`,
    tx_prev_to: `${prevTo} 23:59:59`,
  };
  const txPrevSql = `WHERE t.created_at >= :tx_prev_from AND t.created_at <= :tx_prev_to${
    tx_status && tx_status !== 'all' ? ' AND t.status = :tx_status' : ''
  }`;

  const failedPrevParams = {
    tx_prev_from: `${prevFrom} 00:00:00`,
    tx_prev_to: `${prevTo} 23:59:59`,
    failed_status: 'failed',
  };

  const subGroup = chartGroupExpr('s.created_at', granularity);
  const txGroup = chartGroupExpr('t.created_at', granularity);

  const [
    trackOptions,
    usersKpi,
    subsKpi,
    salesKpi,
    prevUsers,
    prevSubs,
    prevSales,
    failedTx,
    prevFailedTx,
    expiringSubs,
    staleInTransit,
    subsSeriesRaw,
    salesSeriesRaw,
    recentTxns,
    topTracks,
  ] = await Promise.all([
    db.query(
      `SELECT DISTINCT CAST(track_id AS CHAR) AS track_id FROM subscriptions
       WHERE track_id IS NOT NULL ORDER BY 1 LIMIT 300`
    ),
    db.query(
      `SELECT COUNT(*) AS totalUsers FROM users WHERE created_at >= :u_from AND created_at <= :u_to`,
      { u_from: `${from} 00:00:00`, u_to: `${to} 23:59:59` }
    ),
    db.query(`SELECT COUNT(*) AS subsCount FROM subscriptions s ${subWhereSql}`, subParams),
    db.query(
      `SELECT COALESCE(SUM(t.amount),0) AS salesAmount FROM transactions t ${txWhereSql}`,
      txParams
    ),
    db.query(
      `SELECT COUNT(*) AS prevUsers FROM users WHERE created_at >= :u_from AND created_at <= :u_to`,
      { u_from: `${prevFrom} 00:00:00`, u_to: `${prevTo} 23:59:59` }
    ),
    db.query(`SELECT COUNT(*) AS prevSubsCount FROM subscriptions s ${subPrevSql}`, subPrevParams),
    db.query(
      `SELECT COALESCE(SUM(t.amount),0) AS prevSalesAmount FROM transactions t ${txPrevSql}`,
      txPrevParams
    ),
    db.query(`SELECT COUNT(*) AS cnt FROM transactions t ${failedWhere}`, failedParams),
    db.query(
      `SELECT COUNT(*) AS cnt FROM transactions t
       WHERE t.created_at >= :tx_prev_from AND t.created_at <= :tx_prev_to AND t.status = :failed_status`,
      failedPrevParams
    ),
    db.query(
      `SELECT COUNT(*) AS cnt FROM subscriptions WHERE status = 'active' AND end_date IS NOT NULL AND end_date <= DATE_ADD(CURDATE(), INTERVAL 14 DAY)`
    ),
    db.query(`SELECT COUNT(*) AS cnt FROM transactions t ${staleTransitWhere}`),
    db.query(
      `SELECT ${subGroup} AS x, COUNT(*) AS y, COUNT(*) AS cnt
       FROM subscriptions s ${subWhereSql} GROUP BY x ORDER BY x`,
      subParams
    ),
    db.query(
      `SELECT ${txGroup} AS x, COALESCE(SUM(t.amount),0) AS y, COUNT(*) AS cnt
       FROM transactions t ${txWhereSql} GROUP BY x ORDER BY x`,
      txParams
    ),
    db.query(
      `SELECT t.id, t.created_at, t.order_id, t.payment_id, t.email, t.amount, t.status, t.method
       FROM transactions t ${txWhereSql} ORDER BY t.created_at DESC LIMIT 7`,
      txParams
    ),
    db.query(
      `SELECT CAST(s.track_id AS CHAR) AS track_id, COUNT(*) AS cnt FROM subscriptions s ${subWhereSql}
       GROUP BY s.track_id ORDER BY cnt DESC LIMIT 10`,
      subParams
    ),
  ]);

  const totalUsers = usersKpi[0][0].totalUsers;
  const subsCount = subsKpi[0][0].subsCount;
  const salesAmount = Number(salesKpi[0][0].salesAmount || 0);
  const prevUsersN = prevUsers[0][0].prevUsers;
  const prevSubsN = prevSubs[0][0].prevSubsCount;
  const prevSalesN = prevSales[0][0].prevSalesAmount;
  const failedTxCount = failedTx[0][0].cnt;
  const prevFailedN = prevFailedTx[0][0].cnt;
  const staleInTransitCount = staleInTransit[0][0].cnt;

  const subsSeries = aggregateSeriesRows(subsSeriesRaw[0], from, to, granularity);
  const salesSeries = aggregateSeriesRows(salesSeriesRaw[0], from, to, granularity);

  const salesTotalInSeries = sumSeriesAmount(salesSeries);
  const subsTotalInSeries = sumSeriesAmount(subsSeries);
  const revenueReconciled = salesTotalInSeries === salesAmount;

  const filters = {
    preset,
    from,
    to,
    track,
    sub_status,
    tx_status,
    granularity,
    granularityAuto,
    granularity_set,
  };

  const actionQueue = [
    {
      label: 'Failed payments',
      count: failedTxCount,
      href: `/admin/transactions?status=failed&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      priority: failedTxCount > 0 ? 'high' : 'low',
      icon: '!',
    },
    {
      label: 'Subs expiring (14d)',
      count: expiringSubs[0][0].cnt,
      href: '/admin/subscriptions?status=active',
      priority: expiringSubs[0][0].cnt > 0 ? 'medium' : 'low',
      icon: '◷',
    },
  ];

  if (staleInTransitCount > 0) {
    actionQueue.push({
      label: 'Stale in-transit (48h+)',
      count: staleInTransitCount,
      href: '/admin/transactions?status=in_transit',
      priority: 'medium',
      icon: '⏳',
    });
  }

  return {
    filters,
    ranges: { from, to, prevFrom, prevTo, days: range.days },
    trackOptions: (trackOptions[0] || []).map((r) => r.track_id),
    activeFilterCount: countActiveFilters(filters),
    stats: {
      totalUsers,
      subsCount,
      salesAmount,
      failedTxCount,
      deltas: {
        users: formatPeriodDelta(totalUsers, prevUsersN),
        subs: formatPeriodDelta(subsCount, prevSubsN),
        sales: formatPeriodDelta(salesAmount, prevSalesN),
        failed: formatPeriodDelta(failedTxCount, prevFailedN),
      },
    },
    actionQueue,
    subsSeries,
    salesSeries,
    chartMeta: {
      granularity,
      granularityAuto,
      salesTotalInSeries,
      subsTotalInSeries,
      salesAmountKpi: salesAmount,
      revenueReconciled,
      currency: 'INR',
      amountUnit: 'paise',
    },
    recentTxns: recentTxns[0],
    topTracks: topTracks[0],
  };
}

module.exports = {
  parseDateRange,
  loadDashboard,
  aggregateSeriesRows,
  aggregateDailyRows: aggregateSeriesRows,
  enumerateDays: core.enumerateDays,
  enumerateBuckets: core.enumerateBuckets,
  resolveGranularity: core.resolveGranularity,
  sumSeriesAmount,
  chartGroupExpr,
};
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
  buildTxWhere,
  tableHasColumn,
} = core;

const REPORT_TABS = ['overview', 'revenue', 'subscriptions', 'members', 'tracks', 'transactions'];

function normalizeTab(tab) {
  const t = String(tab || 'overview').trim().toLowerCase();
  return REPORT_TABS.includes(t) ? t : 'overview';
}

function txCountWhereClause(range) {
  const { from, to, tx_status, method } = range;
  const parts = ['t.created_at >= :tx_from AND t.created_at <= :tx_to'];
  const params = { tx_from: `${from} 00:00:00`, tx_to: `${to} 23:59:59` };
  if (tx_status && tx_status !== 'all' && tx_status !== 'captured') {
    parts.push('t.status = :tx_status');
    params.tx_status = tx_status;
  }
  if (method) {
    parts.push('t.method = :method');
    params.method = method;
  }
  return { sql: `WHERE ${parts.join(' AND ')}`, params };
}

function revenueWhereClause(range) {
  const txParams = { tx_from: `${range.from} 00:00:00`, tx_to: `${range.to} 23:59:59` };
  const txParts = ['t.created_at >= :tx_from AND t.created_at <= :tx_to'];
  const status = range.tx_status || 'captured';
  if (status && status !== 'all') {
    txParts.push('t.status = :tx_status');
    txParams.tx_status = status;
  }
  if (range.method) {
    txParts.push('t.method = :method');
    txParams.method = range.method;
  }
  return { sql: `WHERE ${txParts.join(' AND ')}`, params: txParams };
}

function mergePeriodBreakdown(salesSeries, subsSeries, memberSeries, txCountSeries) {
  const map = new Map();
  const touch = (row, kind, val) => {
    if (!row.x) return;
    if (!map.has(row.x)) {
      map.set(row.x, {
        period: row.x,
        revenue_paise: 0,
        transactions: 0,
        subscriptions: 0,
        members: 0,
      });
    }
    const cell = map.get(row.x);
    if (kind === 'revenue') cell.revenue_paise = Number(val || 0);
    if (kind === 'tx') cell.transactions = Number(val || 0);
    if (kind === 'subs') cell.subscriptions = Number(val || 0);
    if (kind === 'members') cell.members = Number(val || 0);
  };
  (salesSeries || []).forEach((r) => touch(r, 'revenue', r.y));
  (txCountSeries || []).forEach((r) => touch(r, 'tx', r.cnt ?? r.y));
  (subsSeries || []).forEach((r) => touch(r, 'subs', r.y));
  (memberSeries || []).forEach((r) => touch(r, 'members', r.y));
  return [...map.values()].sort((a, b) => String(a.period).localeCompare(String(b.period)));
}

async function loadKpiBundle(db, range, revWhere, subWhere) {
  const { from, to, prevFrom, prevTo } = range;
  const txCount = txCountWhereClause(range);
  const revParams = revWhere.params;
  const subParams = subWhere.subParams;
  const subPrevWhere = buildSubWhere({ ...range, from: prevFrom, to: prevTo });

  const prevRevParams = {
    ...revParams,
    tx_from: `${prevFrom} 00:00:00`,
    tx_to: `${prevTo} 23:59:59`,
  };

  const prevTxCountParams = {
    ...txCount.params,
    tx_from: `${prevFrom} 00:00:00`,
    tx_to: `${prevTo} 23:59:59`,
  };

  const [
    usersKpi,
    subsKpi,
    salesKpi,
    txCountKpi,
    prevUsers,
    prevSubs,
    prevSales,
    prevTxCount,
    refundKpi,
  ] = await Promise.all([
    db.query(
      `SELECT COUNT(*) AS totalUsers FROM users WHERE created_at >= :u_from AND created_at <= :u_to`,
      { u_from: `${from} 00:00:00`, u_to: `${to} 23:59:59` }
    ),
    db.query(`SELECT COUNT(*) AS subsCount FROM subscriptions s ${subWhere.subWhereSql}`, subParams),
    db.query(
      `SELECT COALESCE(SUM(t.amount),0) AS salesAmount FROM transactions t ${revWhere.sql}`,
      revParams
    ),
    db.query(`SELECT COUNT(*) AS txCount FROM transactions t ${txCount.sql}`, txCount.params),
    db.query(
      `SELECT COUNT(*) AS prevUsers FROM users WHERE created_at >= :u_from AND created_at <= :u_to`,
      { u_from: `${prevFrom} 00:00:00`, u_to: `${prevTo} 23:59:59` }
    ),
    db.query(
      `SELECT COUNT(*) AS prevSubsCount FROM subscriptions s ${subPrevWhere.subWhereSql}`,
      subPrevWhere.subParams
    ),
    db.query(
      `SELECT COALESCE(SUM(t.amount),0) AS prevSalesAmount FROM transactions t ${revWhere.sql}`,
      prevRevParams
    ),
    db.query(`SELECT COUNT(*) AS txCount FROM transactions t ${txCount.sql}`, prevTxCountParams),
    db.query(
      `SELECT COALESCE(SUM(t.amount),0) AS refunded FROM transactions t
       ${revenueWhereClause({ ...range, tx_status: 'refunded' }).sql}`,
      revenueWhereClause({ ...range, tx_status: 'refunded' }).params
    ),
  ]);

  const totalUsers = usersKpi[0][0].totalUsers;
  const subsCount = subsKpi[0][0].subsCount;
  const salesAmount = Number(salesKpi[0][0].salesAmount || 0);
  const transactionCount = txCountKpi[0][0].txCount;
  const prevUsersN = prevUsers[0][0].prevUsers;
  const prevSubsN = prevSubs[0][0].prevSubsCount;
  const prevSalesN = prevSales[0][0].prevSalesAmount;
  const prevTxN = prevTxCount[0][0].txCount;

  return {
    totalUsers,
    subsCount,
    salesAmount,
    transactionCount,
    refundedAmount: Number(refundKpi[0][0].refunded || 0),
    deltas: {
      users: formatPeriodDelta(totalUsers, prevUsersN),
      subs: formatPeriodDelta(subsCount, prevSubsN),
      sales: formatPeriodDelta(salesAmount, prevSalesN),
      transactions: formatPeriodDelta(transactionCount, prevTxN),
    },
  };
}

async function loadReports(db, query) {
  const range = parseDateRange(query);
  const tab = normalizeTab(query.tab);
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(50, Math.max(10, parseInt(query.pageSize, 10) || 25));

  const {
    from,
    to,
    prevFrom,
    prevTo,
    preset,
    granularity,
    granularityAuto,
    granularity_set,
    compare,
    compareLabel,
  } = range;

  const subWhere = buildSubWhere(range);
  const revWhere = revenueWhereClause(range);
  const txCountW = txCountWhereClause(range);

  const subGroup = chartGroupExpr('s.created_at', granularity);
  const txGroup = chartGroupExpr('t.created_at', granularity);
  const userGroup = chartGroupExpr('u.created_at', granularity);
  const txCountGroup = chartGroupExpr('t.created_at', granularity);

  const [
    categories,
    trackOptions,
    stats,
    subsSeriesRaw,
    salesSeriesRaw,
    memberSeriesRaw,
    txCountSeriesRaw,
    txStatusBreakdown,
    topTracksNamed,
    activeTracksByTrack,
    subStatusSnapshot,
    activeSubSnapshot,
    txList,
    txTotal,
    hasTxTrackId,
  ] = await Promise.all([
    db.query(`SELECT id, name FROM categories ORDER BY name LIMIT 200`),
    db.query(
      `SELECT DISTINCT CAST(track_id AS CHAR) AS track_id FROM subscriptions
       WHERE track_id IS NOT NULL ORDER BY 1 LIMIT 300`
    ),
    loadKpiBundle(db, range, revWhere, subWhere),
    db.query(
      `SELECT ${subGroup} AS x, COUNT(*) AS y, COUNT(*) AS cnt
       FROM subscriptions s ${subWhere.subWhereSql} GROUP BY x ORDER BY x`,
      subWhere.subParams
    ),
    db.query(
      `SELECT ${txGroup} AS x, COALESCE(SUM(t.amount),0) AS y, COUNT(*) AS cnt
       FROM transactions t ${revWhere.sql} GROUP BY x ORDER BY x`,
      revWhere.params
    ),
    db.query(
      `SELECT ${userGroup} AS x, COUNT(*) AS y, COUNT(*) AS cnt
       FROM users u WHERE u.created_at >= :u_from AND u.created_at <= :u_to GROUP BY x ORDER BY x`,
      { u_from: `${from} 00:00:00`, u_to: `${to} 23:59:59` }
    ),
    db.query(
      `SELECT ${txCountGroup} AS x, COUNT(*) AS cnt, COUNT(*) AS y
       FROM transactions t ${txCountW.sql} GROUP BY x ORDER BY x`,
      txCountW.params
    ),
    db.query(
      `SELECT t.status, COUNT(*) AS cnt, COALESCE(SUM(t.amount),0) AS amount
       FROM transactions t ${txCountW.sql} GROUP BY t.status ORDER BY cnt DESC`,
      txCountW.params
    ),
    db.query(
      `SELECT CAST(s.track_id AS CHAR) AS track_id, COALESCE(tr.title, CAST(s.track_id AS CHAR)) AS title,
              COUNT(*) AS cnt
       FROM subscriptions s
       LEFT JOIN tracks tr ON tr.id = s.track_id
       ${subWhere.subWhereSql}
       GROUP BY s.track_id, tr.title ORDER BY cnt DESC LIMIT 5`,
      subWhere.subParams
    ),
    db.query(
      `SELECT CAST(s.track_id AS CHAR) AS track_id, COALESCE(tr.title, CAST(s.track_id AS CHAR)) AS title,
              COUNT(*) AS cnt
       FROM subscriptions s
       LEFT JOIN tracks tr ON tr.id = s.track_id
       WHERE s.status = 'active' AND s.track_id IS NOT NULL
       GROUP BY s.track_id, tr.title ORDER BY cnt DESC LIMIT 10`
    ),
    db.query(
      `SELECT status, COUNT(*) AS cnt FROM subscriptions s ${subWhere.subWhereSql} GROUP BY status`,
      subWhere.subParams
    ),
    db.query(
      `SELECT COUNT(*) AS cnt FROM subscriptions WHERE status = 'active'`
    ),
    db.query(
      `SELECT t.id, t.created_at, t.order_id, t.email, t.amount, t.status, t.method
       FROM transactions t ${txCountW.sql} ORDER BY t.created_at DESC LIMIT :limit OFFSET :offset`,
      { ...txCountW.params, limit: pageSize, offset: (page - 1) * pageSize }
    ),
    db.query(`SELECT COUNT(*) AS total FROM transactions t ${txCountW.sql}`, txCountW.params),
    tableHasColumn(db, 'transactions', 'track_id'),
  ]);

  const subsSeries = aggregateSeriesRows(subsSeriesRaw[0], from, to, granularity);
  const salesSeries = aggregateSeriesRows(salesSeriesRaw[0], from, to, granularity);
  const memberSeries = aggregateSeriesRows(memberSeriesRaw[0], from, to, granularity);
  const txCountSeries = aggregateSeriesRows(txCountSeriesRaw[0], from, to, granularity);

  const salesTotalInSeries = sumSeriesAmount(salesSeries);
  const revenueReconciled = salesTotalInSeries === stats.salesAmount;

  const periodBreakdown = mergePeriodBreakdown(salesSeries, subsSeries, memberSeries, txCountSeries);

  const filters = {
    preset,
    from,
    to,
    track: range.track,
    sub_status: range.sub_status,
    tx_status: range.tx_status,
    method: range.method,
    category_id: range.category_id,
    granularity,
    granularityAuto,
    granularity_set,
    compare,
    tab,
    page,
  };

  let revenueByTrack = [];
  if (hasTxTrackId) {
    try {
      const [rows] = await db.query(
        `SELECT CAST(t.track_id AS CHAR) AS track_id, COALESCE(tr.title, CAST(t.track_id AS CHAR)) AS title,
                COALESCE(SUM(t.amount),0) AS revenue_paise
         FROM transactions t
         LEFT JOIN tracks tr ON tr.id = t.track_id
         ${revWhere.sql} AND t.track_id IS NOT NULL
         GROUP BY t.track_id, tr.title ORDER BY revenue_paise DESC LIMIT 10`,
        revWhere.params
      );
      revenueByTrack = rows;
    } catch {
      revenueByTrack = [];
    }
  }

  return {
    tab,
    filters,
    ranges: { from, to, prevFrom, prevTo, days: range.days, compareLabel },
    categoryOptions: categories[0] || [],
    trackOptions: (trackOptions[0] || []).map((r) => r.track_id),
    activeFilterCount: countActiveFilters(filters),
    stats,
    subsSeries,
    salesSeries,
    memberSeries,
    txStatusBreakdown: txStatusBreakdown[0] || [],
    topTracks: topTracksNamed[0] || [],
    activeTracksByTrack: activeTracksByTrack[0] || [],
    revenueByTrack,
    revenueByTrackAvailable: hasTxTrackId,
    subscriptionStatusInPeriod: subStatusSnapshot[0] || [],
    activeSubscriptionsSnapshot: activeSubSnapshot[0][0].cnt,
    periodBreakdown,
    chartMeta: {
      granularity,
      granularityAuto,
      salesTotalInSeries,
      salesAmountKpi: stats.salesAmount,
      revenueReconciled,
      currency: 'INR',
      amountUnit: 'paise',
    },
    transactionsPage: {
      rows: txList[0] || [],
      page,
      pageSize,
      total: txTotal[0][0].total,
      totalPages: Math.max(1, Math.ceil(txTotal[0][0].total / pageSize)),
    },
  };
}

module.exports = { loadReports, REPORT_TABS, normalizeTab, mergePeriodBreakdown };
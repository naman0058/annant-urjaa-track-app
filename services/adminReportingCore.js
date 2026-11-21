'use strict';

function pad(n) {
  return String(n).padStart(2, '0');
}
function fmt(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseIsoDate(s) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return new Date(`${s}T12:00:00`);
}

/**
 * Auto aggregation: 1–31 daily, 32–180 weekly, 181+ monthly.
 */
function resolveGranularity(query, days) {
  const g = String(query.granularity || '').trim().toLowerCase();
  const userSet = String(query.granularity_set || '') === '1';
  if (userSet && (g === 'daily' || g === 'weekly' || g === 'monthly')) {
    return { granularity: g, auto: false };
  }
  if (days > 180) return { granularity: 'monthly', auto: true };
  if (days > 31) return { granularity: 'weekly', auto: true };
  return { granularity: 'daily', auto: true };
}

function enumerateDays(from, to) {
  const start = parseIsoDate(from);
  const end = parseIsoDate(to);
  if (!start || !end) return [];
  const out = [];
  const d = new Date(start);
  while (d <= end) {
    out.push(fmt(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function enumerateMonthBuckets(from, to) {
  const start = parseIsoDate(from);
  const end = parseIsoDate(to);
  if (!start || !end) return [];
  const out = [];
  const d = new Date(start.getFullYear(), start.getMonth(), 1);
  const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);
  while (d <= endMonth) {
    out.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
    d.setMonth(d.getMonth() + 1);
  }
  return out;
}

function bucketKeyForDate(isoDate, granularity) {
  const d = parseIsoDate(isoDate);
  if (!d) return isoDate;
  if (granularity === 'daily') return fmt(d);
  if (granularity === 'weekly') {
    const day = d.getDay();
    const monday = new Date(d);
    const diff = day === 0 ? -6 : 1 - day;
    monday.setDate(d.getDate() + diff);
    return fmt(monday);
  }
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

function enumerateBuckets(from, to, granularity) {
  if (granularity === 'daily') return enumerateDays(from, to);
  if (granularity === 'monthly') return enumerateMonthBuckets(from, to);
  const days = enumerateDays(from, to);
  return [...new Set(days.map((day) => bucketKeyForDate(day, 'weekly')))].sort();
}

function chartGroupExpr(column, granularity) {
  if (granularity === 'monthly') {
    return `DATE_FORMAT(${column}, '%Y-%m')`;
  }
  if (granularity === 'weekly') {
    return `DATE(DATE_SUB(${column}, INTERVAL WEEKDAY(${column}) DAY))`;
  }
  return `DATE(${column})`;
}

function normalizeRowX(row, granularity) {
  const raw =
    row.x instanceof Date
      ? granularity === 'monthly'
        ? `${row.x.getFullYear()}-${pad(row.x.getMonth() + 1)}`
        : fmt(row.x)
      : String(row.x);
  if (granularity === 'monthly') {
    if (/^\d{4}-\d{2}$/.test(raw)) return raw;
    return raw.slice(0, 7);
  }
  return raw.slice(0, 10);
}

function aggregateSeriesRows(rows, from, to, granularity) {
  const buckets = enumerateBuckets(from, to, granularity);
  const acc = new Map();
  buckets.forEach((b) => acc.set(b, { x: b, y: 0, cnt: 0 }));

  (rows || []).forEach((row) => {
    const rawX = normalizeRowX(row, granularity);
    const key =
      granularity === 'daily' ? rawX : bucketKeyForDate(rawX, granularity);
    if (!acc.has(key)) acc.set(key, { x: key, y: 0, cnt: 0 });
    const cell = acc.get(key);
    cell.y += Number(row.y || 0);
    cell.cnt += Number(row.cnt != null ? row.cnt : 0);
  });

  return buckets.map((b) => acc.get(b));
}

function sumSeriesAmount(series) {
  return (series || []).reduce((s, r) => s + Number(r.y || 0), 0);
}

function parseDateRange(query) {
  const rawPreset = String(query.preset || '').trim();
  const track = String(query.track || '').trim();
  const sub_status = String(query.sub_status || 'all').trim();
  const tx_status = String(query.tx_status || 'captured').trim();
  const method = String(query.method || '').trim();
  const category_id = String(query.category_id || '').trim();
  const compare = String(query.compare || 'prev_period').trim();

  let from = String(query.from || '').trim();
  let to = String(query.to || '').trim();
  const t = new Date();
  const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
  const endOfMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);

  const namedPresets = {
    today: () => {
      from = fmt(t);
      to = fmt(t);
    },
    yesterday: () => {
      const d = new Date(t);
      d.setDate(d.getDate() - 1);
      from = fmt(d);
      to = fmt(d);
    },
    '7d': () => {
      const d = new Date(t);
      d.setDate(d.getDate() - 6);
      from = fmt(d);
      to = fmt(t);
    },
    '30d': () => {
      const d = new Date(t);
      d.setDate(d.getDate() - 29);
      from = fmt(d);
      to = fmt(t);
    },
    '90d': () => {
      const d = new Date(t);
      d.setDate(d.getDate() - 89);
      from = fmt(d);
      to = fmt(t);
    },
    this_month: () => {
      from = fmt(startOfMonth(t));
      to = fmt(t);
    },
    last_month: () => {
      const lm = new Date(t.getFullYear(), t.getMonth() - 1, 15);
      from = fmt(startOfMonth(lm));
      to = fmt(endOfMonth(lm));
    },
  };

  let effectivePreset = '30d';

  if (rawPreset === 'custom') {
    if (from && to && parseIsoDate(from) && parseIsoDate(to)) {
      if (parseIsoDate(from) > parseIsoDate(to)) {
        const swap = from;
        from = to;
        to = swap;
      }
      effectivePreset = 'custom';
    } else {
      namedPresets['30d']();
      effectivePreset = '30d';
    }
  } else if (rawPreset && namedPresets[rawPreset]) {
    namedPresets[rawPreset]();
    effectivePreset = rawPreset;
  } else if (from && to && parseIsoDate(from) && parseIsoDate(to)) {
    if (parseIsoDate(from) > parseIsoDate(to)) {
      const swap = from;
      from = to;
      to = swap;
    }
    effectivePreset = 'custom';
  } else {
    namedPresets['30d']();
    effectivePreset = '30d';
  }

  const fromD = parseIsoDate(from);
  const toD = parseIsoDate(to);
  const days = Math.max(1, Math.round((toD - fromD) / 86400000) + 1);
  const { granularity, auto: granularityAuto } = resolveGranularity(query, days);
  const granularitySet = String(query.granularity_set || '') === '1';
  const compareWindow = buildCompareRange(compare, from, to, days);

  return {
    preset: effectivePreset,
    from,
    to,
    track,
    sub_status,
    tx_status,
    method,
    category_id,
    compare: compare === 'none' ? 'none' : compare || 'prev_period',
    prevFrom: compareWindow.from,
    prevTo: compareWindow.to,
    compareLabel: compareWindow.label,
    days,
    granularity,
    granularityAuto,
    granularity_set: granularitySet ? '1' : '',
  };
}

function buildCompareRange(compare, from, to, days) {
  if (compare === 'none') {
    return { from: '', to: '', label: 'No comparison' };
  }
  const fromD = parseIsoDate(from);
  const toD = parseIsoDate(to);
  if (!fromD || !toD) {
    return { from: '', to: '', label: '' };
  }

  if (compare === 'prev_year') {
    const pf = new Date(fromD);
    const pt = new Date(toD);
    pf.setFullYear(pf.getFullYear() - 1);
    pt.setFullYear(pt.getFullYear() - 1);
    return { from: fmt(pf), to: fmt(pt), label: 'Previous year' };
  }

  if (compare === 'prev_month') {
    const pf = new Date(fromD);
    const pt = new Date(toD);
    pf.setMonth(pf.getMonth() - 1);
    pt.setMonth(pt.getMonth() - 1);
    return { from: fmt(pf), to: fmt(pt), label: 'Previous month' };
  }

  const prevTo = new Date(fromD);
  prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setDate(prevFrom.getDate() - (days - 1));
  return {
    from: fmt(prevFrom),
    to: fmt(prevTo),
    label: 'Previous period',
  };
}

function countActiveFilters(filters) {
  let n = 0;
  if (filters.track) n += 1;
  if (filters.sub_status && filters.sub_status !== 'all') n += 1;
  if (filters.tx_status && filters.tx_status !== 'captured') n += 1;
  if (filters.method) n += 1;
  if (filters.category_id) n += 1;
  return n;
}

function buildTxWhere(range, { allStatusesForCount } = {}) {
  const { from, to, tx_status, method } = range;
  const txParams = { tx_from: `${from} 00:00:00`, tx_to: `${to} 23:59:59` };
  const txParts = ['t.created_at >= :tx_from AND t.created_at <= :tx_to'];
  if (!allStatusesForCount && tx_status && tx_status !== 'all') {
    txParts.push('t.status = :tx_status');
    txParams.tx_status = tx_status;
  } else if (allStatusesForCount && tx_status && tx_status !== 'all') {
    txParts.push('t.status = :tx_status');
    txParams.tx_status = tx_status;
  }
  if (method) {
    txParts.push('t.method = :method');
    txParams.method = method;
  }
  return { txWhereSql: `WHERE ${txParts.join(' AND ')}`, txParams };
}

function buildSubWhere(range) {
  const { from, to, track, sub_status, category_id } = range;
  const subParams = {
    sub_from: `${from} 00:00:00`,
    sub_to: `${to} 23:59:59`,
  };
  const subParts = ['s.created_at >= :sub_from AND s.created_at <= :sub_to'];
  if (track) {
    subParts.push('CAST(s.track_id AS CHAR) = :track');
    subParams.track = track;
  }
  if (sub_status && sub_status !== 'all') {
    subParts.push('s.status = :sub_status');
    subParams.sub_status = sub_status;
  }
  if (category_id) {
    subParts.push(
      'EXISTS (SELECT 1 FROM tracks tr WHERE tr.id = s.track_id AND tr.category_id = :category_id)'
    );
    subParams.category_id = category_id;
  }
  return { subWhereSql: `WHERE ${subParts.join(' AND ')}`, subParams };
}

async function tableHasColumn(db, table, column) {
  try {
    const [rows] = await db.query(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table AND COLUMN_NAME = :column LIMIT 1`,
      { table, column }
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

module.exports = {
  pad,
  fmt,
  parseIsoDate,
  parseDateRange,
  resolveGranularity,
  enumerateDays,
  enumerateBuckets,
  bucketKeyForDate,
  chartGroupExpr,
  aggregateSeriesRows,
  aggregateDailyRows: aggregateSeriesRows,
  sumSeriesAmount,
  countActiveFilters,
  buildCompareRange,
  buildTxWhere,
  buildSubWhere,
  tableHasColumn,
};
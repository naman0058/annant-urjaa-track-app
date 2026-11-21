'use strict';

const { tableHasColumn } = require('./adminReportingCore');

const STATUSES = ['active', 'expired', 'cancelled'];
const EXPIRING_SOON_DAYS = 7;
const SORT_MAP = {
  created_at: 's.created_at',
  start_date: 's.start_date',
  end_date: 's.end_date',
  status: 's.status',
  track_id: 's.track_id',
  user_name: 'u.name',
};

function parseListQuery(query = {}) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 5), 100);
  const sort = String(query.sort || 'created_at').trim();
  const dir = String(query.dir || 'desc').trim().toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const sortSql = SORT_MAP[sort] || SORT_MAP.created_at;

  const filters = {
    q: String(query.q || '').trim(),
    status: String(query.status || '').trim(),
    track: String(query.track || '').trim(),
    user_id: String(query.user_id || '').trim(),
    from: String(query.from || '').trim(),
    to: String(query.to || '').trim(),
    start_from: String(query.start_from || '').trim(),
    start_to: String(query.start_to || '').trim(),
    end_from: String(query.end_from || '').trim(),
    end_to: String(query.end_to || '').trim(),
    sort,
    dir: dir === 'ASC' ? 'asc' : 'desc',
    limit,
    page,
  };

  return { page, limit, offset: (page - 1) * limit, sortSql, dir, filters };
}

function buildSubscriptionWhere(filters, { hasTrackId } = {}) {
  const where = [];
  const params = {};
  const f = filters || {};

  if (f.q) {
    const qMaybeId = Number(f.q);
    if (Number.isInteger(qMaybeId) && qMaybeId > 0) {
      where.push(
        hasTrackId
          ? '(s.id = :qid OR u.name LIKE :q OR u.email LIKE :q OR CAST(s.track_id AS CHAR) LIKE :q OR t.title LIKE :q)'
          : '(s.id = :qid OR u.name LIKE :q OR u.email LIKE :q OR s.track LIKE :q)'
      );
      params.qid = qMaybeId;
    } else {
      where.push(
        hasTrackId
          ? '(u.name LIKE :q OR u.email LIKE :q OR CAST(s.track_id AS CHAR) LIKE :q OR t.title LIKE :q)'
          : '(u.name LIKE :q OR u.email LIKE :q OR s.track LIKE :q)'
      );
    }
    params.q = `%${f.q}%`;
  }

  if (f.status && STATUSES.includes(f.status)) {
    where.push('s.status = :status');
    params.status = f.status;
  }

  if (f.track) {
    if (hasTrackId) {
      where.push('(CAST(s.track_id AS CHAR) LIKE :track OR t.title LIKE :track)');
    } else {
      where.push('s.track LIKE :track');
    }
    params.track = `%${f.track}%`;
  }

  if (f.user_id) {
    const uid = Number(f.user_id);
    if (Number.isInteger(uid) && uid > 0) {
      where.push('s.user_id = :user_id');
      params.user_id = uid;
    }
  }

  if (f.from) {
    where.push('s.created_at >= :from');
    params.from = `${f.from} 00:00:00`;
  }
  if (f.to) {
    where.push('s.created_at <= :to');
    params.to = `${f.to} 23:59:59`;
  }
  if (f.start_from) {
    where.push('s.start_date >= :start_from');
    params.start_from = `${f.start_from} 00:00:00`;
  }
  if (f.start_to) {
    where.push('s.start_date <= :start_to');
    params.start_to = `${f.start_to} 23:59:59`;
  }
  if (f.end_from) {
    where.push('s.end_date >= :end_from');
    params.end_from = `${f.end_from} 00:00:00`;
  }
  if (f.end_to) {
    where.push('s.end_date <= :end_to');
    params.end_to = `${f.end_to} 23:59:59`;
  }

  const joinTrack = hasTrackId ? 'LEFT JOIN tracks t ON t.id = s.track_id' : '';
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  return { whereSql, params, joinTrack };
}

function countActiveFilters(filters) {
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
  ];
  return keys.reduce((acc, k) => (String(filters[k] || '').trim() ? acc + 1 : acc), 0);
}

function validateDateRange(start, end) {
  if (!start || !end) return { ok: true };
  if (String(start) > String(end)) {
    return { ok: false, error: 'Start date cannot be after end date.' };
  }
  return { ok: true };
}

function validateStatusTransition(fromStatus, toStatus, { grantReason, adminRole } = {}) {
  const from = String(fromStatus || '').toLowerCase();
  const to = String(toStatus || '').toLowerCase();
  if (!STATUSES.includes(to)) {
    return { ok: false, error: 'Invalid status.' };
  }
  if (from === to) return { ok: true };

  return { ok: true };
}

function validateActiveGrant(status) {
  if (status !== 'active') return { ok: true };
  return { ok: true };
}

async function getTrackMode(db) {
  const hasTrackId = await tableHasColumn(db, 'subscriptions', 'track_id');
  return { hasTrackId, mode: hasTrackId ? 'track_id' : 'track' };
}

async function subscriptionTimestamps(db) {
  const hasUpdatedAt = await tableHasColumn(db, 'subscriptions', 'updated_at');
  const hasCreatedAt = await tableHasColumn(db, 'subscriptions', 'created_at');
  const insertCols =
    hasUpdatedAt && hasCreatedAt
      ? ', created_at, updated_at'
      : hasUpdatedAt
        ? ', updated_at'
        : '';
  const insertVals =
    hasUpdatedAt && hasCreatedAt ? ', NOW(), NOW()' : hasUpdatedAt ? ', NOW()' : '';
  const updateSet = hasUpdatedAt ? ', updated_at = NOW()' : '';
  return { insertCols, insertVals, updateSet };
}

function selectListSql(hasTrackId) {
  const trackTitle = hasTrackId
    ? 'COALESCE(t.title, CAST(s.track_id AS CHAR)) AS track_title'
    : 's.track AS track_title';
  const trackKey = hasTrackId ? 'CAST(s.track_id AS CHAR) AS track_key' : 's.track AS track_key';
  return `s.id, s.user_id, u.name AS user_name, u.email,
          ${trackKey}, ${trackTitle},
          s.status, s.start_date, s.end_date, s.created_at`;
}

async function getSubscriptionKpis(db) {
  const [[activeRow]] = await db.query(
    `SELECT COUNT(*) AS cnt FROM subscriptions s
     WHERE s.status = 'active' AND (s.end_date IS NULL OR s.end_date > CURDATE())`
  );
  const [[expiringRow]] = await db.query(
    `SELECT COUNT(*) AS cnt FROM subscriptions s
     WHERE s.status = 'active'
       AND s.end_date IS NOT NULL
       AND s.end_date > CURDATE()
       AND s.end_date <= DATE_ADD(CURDATE(), INTERVAL :days DAY)`,
    { days: EXPIRING_SOON_DAYS }
  );
  const [[totalAll]] = await db.query(`SELECT COUNT(*) AS cnt FROM subscriptions`);
  return {
    activeSnapshot: Number(activeRow.cnt || 0),
    expiringSoon: Number(expiringRow.cnt || 0),
    totalAll: Number(totalAll.cnt || 0),
  };
}

async function listSubscriptions(db, query) {
  const { page, limit, offset, sortSql, dir, filters } = parseListQuery(query);
  const { hasTrackId } = await getTrackMode(db);
  const { whereSql, params, joinTrack } = buildSubscriptionWhere(filters, { hasTrackId });

  const listParams = { ...params, limit, offset };

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM subscriptions s
     JOIN users u ON u.id = s.user_id
     ${joinTrack}
     ${whereSql}`,
    params
  );

  const [rows] = await db.query(
    `SELECT ${selectListSql(hasTrackId)}
     FROM subscriptions s
     JOIN users u ON u.id = s.user_id
     ${joinTrack}
     ${whereSql}
     ORDER BY ${sortSql} ${dir}
     LIMIT :limit OFFSET :offset`,
    listParams
  );

  const kpis = await getSubscriptionKpis(db);
  const [trackOptions] = hasTrackId
    ? await db.query(
        `SELECT id, title FROM tracks WHERE status = 'active' ORDER BY title LIMIT 200`
      )
    : [[]];

  return {
    rows,
    pagination: {
      page,
      limit,
      total: Number(total || 0),
      totalPages: Math.max(1, Math.ceil(Number(total || 0) / limit)),
    },
    filters,
    activeFilterCount: countActiveFilters(filters),
    kpis,
    hasTrackId,
    trackOptions: trackOptions || [],
    datasetEmpty: kpis.totalAll === 0,
  };
}

async function listSubscriptionsForExport(db, query, cap = 10000) {
  const { sortSql, dir, filters } = parseListQuery(query);
  const { hasTrackId } = await getTrackMode(db);
  const { whereSql, params, joinTrack } = buildSubscriptionWhere(filters, { hasTrackId });

  const [rows] = await db.query(
    `SELECT ${selectListSql(hasTrackId)}
     FROM subscriptions s
     JOIN users u ON u.id = s.user_id
     ${joinTrack}
     ${whereSql}
     ORDER BY ${sortSql} ${dir}
     LIMIT :cap`,
    { ...params, cap }
  );
  return rows;
}

async function lookupTracks(db, q, limit = 15) {
  const term = String(q || '').trim();
  if (term.length < 1) return [];
  const { hasTrackId } = await getTrackMode(db);
  if (!hasTrackId) {
    const [rows] = await db.query(
      `SELECT DISTINCT track AS title, track AS id FROM subscriptions
       WHERE track LIKE :q ORDER BY track LIMIT :limit`,
      { q: `%${term}%`, limit }
    );
    return rows.map((r) => ({ id: r.id, title: r.title, price_paise: null }));
  }
  const qNum = Number(term);
  const sql =
    Number.isInteger(qNum) && qNum > 0
      ? `SELECT id, title, price_paise FROM tracks
         WHERE status = 'active' AND (id = :id OR title LIKE :q) ORDER BY title LIMIT :limit`
      : `SELECT id, title, price_paise FROM tracks
         WHERE status = 'active' AND title LIKE :q ORDER BY title LIMIT :limit`;
  const params = { q: `%${term}%`, limit };
  if (Number.isInteger(qNum) && qNum > 0) params.id = qNum;
  const [rows] = await db.query(sql, params);
  return rows;
}

async function getSubscriptionById(db, id) {
  const { hasTrackId } = await getTrackMode(db);
  const joinTrack = hasTrackId ? 'LEFT JOIN tracks t ON t.id = s.track_id' : '';
  const trackTitle = hasTrackId
    ? 'COALESCE(t.title, CAST(s.track_id AS CHAR)) AS track_title'
    : 's.track AS track_title';
  const trackKey = hasTrackId ? 'CAST(s.track_id AS CHAR) AS track_key' : 's.track AS track_key';

  const [rows] = await db.query(
    `SELECT s.*, u.name AS user_name, u.email AS user_email,
            ${trackKey}, ${trackTitle}
     FROM subscriptions s
     INNER JOIN users u ON u.id = s.user_id
     ${joinTrack}
     WHERE s.id = :id LIMIT 1`,
    { id }
  );
  return rows[0] || null;
}

async function assertUserExists(db, userId) {
  const [rows] = await db.query(`SELECT id, name, email FROM users WHERE id = :id LIMIT 1`, {
    id: userId,
  });
  return rows[0] || null;
}

async function assertTrackExists(db, trackRef, hasTrackId) {
  if (!hasTrackId) return { ok: true, trackValue: String(trackRef).trim() };
  const tid = parseInt(trackRef, 10);
  if (!tid) return { ok: false, error: 'Invalid track.' };
  const [rows] = await db.query(
    `SELECT id, title FROM tracks WHERE id = :id AND status = 'active' LIMIT 1`,
    { id: tid }
  );
  if (!rows[0]) return { ok: false, error: 'Track not found or inactive.' };
  return { ok: true, trackValue: tid, title: rows[0].title };
}

async function createSubscription(db, payload, adminRole) {
  const userId = parseInt(payload.user_id, 10);
  if (!userId) return { ok: false, error: 'Valid member is required.' };

  const user = await assertUserExists(db, userId);
  if (!user) return { ok: false, error: 'Member not found.' };

  const status = String(payload.status || '').trim().toLowerCase() || 'expired';
  if (!STATUSES.includes(status)) return { ok: false, error: 'Invalid status.' };

  const grantCheck = validateActiveGrant(status, payload.grant_reason, adminRole);
  if (!grantCheck.ok) return grantCheck;

  const dateCheck = validateDateRange(payload.start_date, payload.end_date);
  if (!dateCheck.ok) return dateCheck;

  const { hasTrackId } = await getTrackMode(db);
  const trackCheck = await assertTrackExists(db, payload.track, hasTrackId);
  if (!trackCheck.ok) return trackCheck;

  const { insertCols, insertVals } = await subscriptionTimestamps(db);

  try {
    if (hasTrackId) {
      const [result] = await db.query(
        `INSERT INTO subscriptions (user_id, track_id, status, start_date, end_date${insertCols})
         VALUES (:user_id, :track_id, :status, :start_date, :end_date${insertVals})`,
        {
          user_id: userId,
          track_id: trackCheck.trackValue,
          status,
          start_date: payload.start_date || null,
          end_date: payload.end_date || null,
        }
      );
      return {
        ok: true,
        id: result.insertId,
        after: { status, user_id: userId, track_id: trackCheck.trackValue },
        grantReason: payload.grant_reason,
      };
    }
    const [result] = await db.query(
      `INSERT INTO subscriptions (user_id, track, status, start_date, end_date${insertCols})
       VALUES (:user_id, :track, :status, :start_date, :end_date${insertVals})`,
      {
        user_id: userId,
        track: trackCheck.trackValue,
        status,
        start_date: payload.start_date || null,
        end_date: payload.end_date || null,
      }
    );
    return {
      ok: true,
      id: result.insertId,
      after: { status, user_id: userId, track: trackCheck.trackValue },
      grantReason: payload.grant_reason,
    };
  } catch (err) {
    console.error('createSubscription', err);
    return { ok: false, error: 'Could not create subscription.' };
  }
}

async function updateSubscription(db, id, payload, adminRole) {
  const existing = await getSubscriptionById(db, id);
  if (!existing) return { ok: false, error: 'Subscription not found.', code: 404 };

  const status = String(payload.status || existing.status).trim().toLowerCase();
  const transition = validateStatusTransition(existing.status, status, {
    grantReason: payload.grant_reason,
    adminRole,
  });
  if (!transition.ok) return transition;

  const grantCheck = validateActiveGrant(status, payload.grant_reason, adminRole);
  if (!grantCheck.ok) return grantCheck;

  const dateCheck = validateDateRange(
    payload.start_date || existing.start_date,
    payload.end_date || existing.end_date
  );
  if (!dateCheck.ok) return dateCheck;

  const { hasTrackId } = await getTrackMode(db);
  const trackCheck = await assertTrackExists(db, payload.track ?? existing.track_key, hasTrackId);
  if (!trackCheck.ok) return trackCheck;

  const before = {
    status: existing.status,
    start_date: existing.start_date,
    end_date: existing.end_date,
    track: existing.track_key,
  };

  const { updateSet } = await subscriptionTimestamps(db);

  try {
    if (hasTrackId) {
      await db.query(
        `UPDATE subscriptions SET track_id=:track_id, status=:status,
         start_date=:start_date, end_date=:end_date${updateSet} WHERE id=:id`,
        {
          id,
          track_id: trackCheck.trackValue,
          status,
          start_date: payload.start_date || null,
          end_date: payload.end_date || null,
        }
      );
    } else {
      await db.query(
        `UPDATE subscriptions SET track=:track, status=:status,
         start_date=:start_date, end_date=:end_date${updateSet} WHERE id=:id`,
        {
          id,
          track: trackCheck.trackValue,
          status,
          start_date: payload.start_date || null,
          end_date: payload.end_date || null,
        }
      );
    }
    return {
      ok: true,
      before,
      after: {
        status,
        start_date: payload.start_date || null,
        end_date: payload.end_date || null,
        track: trackCheck.trackValue,
      },
      grantReason: payload.grant_reason,
    };
  } catch (err) {
    console.error('updateSubscription', err);
    return { ok: false, error: 'Could not update subscription.' };
  }
}

async function cancelSubscription(db, id, cancelReason) {
  const existing = await getSubscriptionById(db, id);
  if (!existing) return { ok: false, error: 'Subscription not found.', code: 404 };
  if (existing.status === 'cancelled') {
    return { ok: false, error: 'Subscription is already cancelled.' };
  }
  const { updateSet } = await subscriptionTimestamps(db);
  await db.query(`UPDATE subscriptions SET status = 'cancelled'${updateSet} WHERE id = :id`, { id });
  return {
    ok: true,
    before: { status: existing.status },
    after: { status: 'cancelled' },
    cancelReason,
  };
}

async function deleteSubscription(db, id) {
  const existing = await getSubscriptionById(db, id);
  if (!existing) return { ok: false, error: 'Subscription not found.', code: 404 };
  await db.query(`DELETE FROM subscriptions WHERE id = :id`, { id });
  return { ok: true, before: existing };
}

async function listSubscriptionAudit(db, subscriptionId, limit = 30) {
  try {
    const [rows] = await db.query(
      `SELECT a.*, ad.email AS actor_email FROM admin_audit_logs a
       LEFT JOIN admins ad ON ad.id = a.admin_id
       WHERE a.entity_type = 'subscription' AND a.entity_id = :eid
       ORDER BY a.created_at DESC LIMIT :limit`,
      { eid: String(subscriptionId), limit }
    );
    return rows;
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE') return [];
    throw err;
  }
}

function summarizeIssuanceFromAudit(auditRows) {
  const rows = auditRows || [];
  const grant = rows.find((a) =>
    ['subscription.admin_grant', 'subscription.create'].includes(String(a.action))
  );
  if (!grant) {
    return { type: 'unknown', reason: null, actor: null, at: null };
  }
  let meta = {};
  try {
    meta = grant.metadata_json ? JSON.parse(grant.metadata_json) : grant.metadata || {};
  } catch (_) {
    meta = {};
  }
  const reason = meta.reason || meta.grantReason || null;
  const after = meta.after || {};
  const isActiveGrant =
    String(grant.action) === 'subscription.admin_grant' || after.status === 'active';
  return {
    type: isActiveGrant ? 'complimentary' : 'admin',
    reason,
    actor: grant.actor_email || null,
    at: grant.created_at || null,
  };
}

async function getLinkedPayments(db, subscriptionId, limit = 5) {
  const id = Number(subscriptionId);
  if (!id) return { rows: [], linkage: 'none' };
  const hasCol = await tableHasColumn(db, 'transactions', 'subscription_id');
  if (!hasCol) {
    return { rows: [], linkage: 'none' };
  }
  const [rows] = await db.query(
    `SELECT id, order_id, amount, status, method, created_at, subscription_id
     FROM transactions
     WHERE subscription_id = :sub_id
     ORDER BY created_at DESC
     LIMIT :limit`,
    { sub_id: id, limit }
  );
  return { rows, linkage: 'subscription_id' };
}

async function getMemberTransactionHistory(db, userId, email, { page = 1, limit = 5 } = {}) {
  const offset = (Math.max(page, 1) - 1) * limit;
  const hasSubCol = await tableHasColumn(db, 'transactions', 'subscription_id');
  const txSelect = hasSubCol
    ? 'id, order_id, amount, status, method, created_at, subscription_id'
    : 'id, order_id, amount, status, method, created_at';
  const hasUserId = await tableHasColumn(db, 'transactions', 'user_id');
  if (hasUserId && userId) {
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM transactions WHERE user_id = :uid`,
      { uid: Number(userId) }
    );
    const [rows] = await db.query(
      `SELECT ${txSelect}
       FROM transactions WHERE user_id = :uid
       ORDER BY created_at DESC LIMIT :limit OFFSET :offset`,
      { uid: Number(userId), limit, offset }
    );
    return {
      rows,
      total: Number(total || 0),
      page,
      limit,
      source: 'user_id',
    };
  }
  if (!email) {
    return { rows: [], total: 0, page, limit, source: 'none' };
  }
  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM transactions WHERE email = :email`,
    { email }
  );
  const [rows] = await db.query(
    `SELECT ${txSelect}
     FROM transactions WHERE email = :email
     ORDER BY created_at DESC LIMIT :limit OFFSET :offset`,
    { email, limit, offset }
  );
  return {
    rows,
    total: Number(total || 0),
    page,
    limit,
    source: 'email_fallback',
  };
}

/** @deprecated Use getLinkedPayments — never use for "Related Payments" UI */
async function relatedTransactions(db, email, limit = 10) {
  return (await getMemberTransactionHistory(db, null, email, { limit, page: 1 })).rows;
}

function statusBadgeClass(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'active') return 'success';
  if (s === 'cancelled') return 'danger';
  return 'warning';
}

function formatStatusLabel(status) {
  const s = String(status || '');
  if (!s) return '—';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

module.exports = {
  STATUSES,
  EXPIRING_SOON_DAYS,
  getTrackMode,
  parseListQuery,
  buildSubscriptionWhere,
  countActiveFilters,
  validateDateRange,
  validateStatusTransition,
  validateActiveGrant,
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
  relatedTransactions,
  getSubscriptionKpis,
  statusBadgeClass,
  formatStatusLabel,
};
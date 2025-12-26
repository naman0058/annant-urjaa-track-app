const express = require('express')
const bcrypt = require('bcryptjs')
const { body, validationResult } = require('express-validator')
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const router = express.Router()

// Helper to escape CSV values
const csvEscape = (v) => {
  if (v === null || v === undefined) return '""';
  return `"${String(v).replace(/"/g, '""')}"`;
};

(async () => {
  console.log(await bcrypt.hash('admin123', 10));
})();



const requireAuth = (req, res, next) => {

  if (req.session && req.session.admin) return next()
  return res.redirect('/admin/login')
}
const requireRole = (roles) => (req, res, next) => {
  console.log('res',req.session.admin.role)

  const role = req.session?.admin?.role || 'viewer'
  if (roles.includes(role)) return next()
  req.flash('error', 'You do not have permission for that action')
  return res.redirect('back')
}

router.get('/login', (req, res) => {
  if (req.session && req.session.admin) return res.redirect('/admin/dashboard')
  res.render('login', { title: 'Admin Login',layout: false  })
})

router.post('/login',
  body('email').isEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 6 }).withMessage('Password required'),
  async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      req.flash('error', errors.array().map(e => e.msg))
      return res.redirect('/admin/login')
    }
    const { email, password } = req.body
    try {
      const [rows] = await req.db.query('SELECT * FROM admins WHERE email = :email LIMIT 1', { email })
      if (!rows.length) { req.flash('error', 'Invalid credentials'); return res.redirect('/admin/login') }
      const admin = rows[0]
      console.log('password',password)
      console.log('admin.password_hash',admin.password_hash)

      const ok = await bcrypt.compare(password, admin.password_hash)
      if (!ok) { req.flash('error', 'Invalid credentials'); return res.redirect('/admin/login') }
      req.session.admin = { id: admin.id, email: admin.email, name: admin.name, role: admin.role }
      req.flash('success', 'Logged in successfully')
      res.redirect('/admin/dashboard')
    } catch (err) { console.error(err); req.flash('error', 'Login failed'); res.redirect('/admin/login') }
  }
)

router.get('/logout', (req, res) => { req.session.destroy(() => res.redirect('/admin/login')) })

// router.get('/dashboard', requireAuth, async (req, res) => {
//   try {
//     const [[{ totalUsers }]] = await req.db.query('SELECT COUNT(*) AS totalUsers FROM users')
//     const [[{ totalSubscribers }]] = await req.db.query('SELECT COUNT(user_id) AS totalSubscribers FROM subscriptions WHERE status = "active"')
//     const [[{ totalSales }]] = await req.db.query('SELECT COALESCE(SUM(amount),0) AS totalSales FROM transactions WHERE status = "captured"')

//     const [subsMonthly] = await req.db.query(`
//       SELECT DATE_FORMAT(created_at, '%Y-%m') AS ym, COUNT(*) AS count
//       FROM subscriptions
//       WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 11 MONTH)
//       GROUP BY ym
//       ORDER BY ym
//     `)
//     const [salesMonthly] = await req.db.query(`
//       SELECT DATE_FORMAT(created_at, '%Y-%m') AS ym, SUM(amount) AS amount
//       FROM transactions
//       WHERE status = "captured" AND created_at >= DATE_SUB(CURDATE(), INTERVAL 11 MONTH)
//       GROUP BY ym
//       ORDER BY ym
//     `)

//     res.render('dashboard', {
//       title: 'Admin Dashboard',
//       stats: { totalUsers, totalSubscribers, totalSales },
//       subsMonthly,
//       salesMonthly
//     })
//   } catch (err) {
//     console.error(err)
//     res.render('dashboard', {
//       title: 'Admin Dashboard',
//       stats: { totalUsers: 0, totalSubscribers: 0, totalSales: 0 },
//       subsMonthly: [],
//       salesMonthly: []
//     })
//   }
// })


router.get('/dashboard', requireAuth, async (req, res) => {
  // ---- Read filters ----
  const preset = String(req.query.preset || '').trim(); // 7d | 30d | 90d | this_month | last_month | ytd
  const track = String(req.query.track || '').trim();   // track_id or empty = all
  const sub_status = String(req.query.sub_status || 'active').trim(); // active|expired|cancelled|all
  const tx_status = String(req.query.tx_status || 'captured').trim(); // captured|created|failed|refunded|all

  const today = new Date(); // server time
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  let from = String(req.query.from || '').trim(); // YYYY-MM-DD
  let to = String(req.query.to || '').trim();     // YYYY-MM-DD

  // ---- Apply preset if provided (overrides manual) ----
  const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
  const endOfMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const startOfYear = (d) => new Date(d.getFullYear(), 0, 1);

  if (preset) {
    const t = new Date();
    if (preset === '7d') {
      const d = new Date(t); d.setDate(d.getDate() - 6);
      from = fmt(d); to = fmt(t);
    } else if (preset === '30d') {
      const d = new Date(t); d.setDate(d.getDate() - 29);
      from = fmt(d); to = fmt(t);
    } else if (preset === '90d') {
      const d = new Date(t); d.setDate(d.getDate() - 89);
      from = fmt(d); to = fmt(t);
    } else if (preset === 'this_month') {
      from = fmt(startOfMonth(t));
      to = fmt(t);
    } else if (preset === 'last_month') {
      const lm = new Date(t.getFullYear(), t.getMonth() - 1, 15);
      from = fmt(startOfMonth(lm));
      to = fmt(endOfMonth(lm));
    } else if (preset === 'ytd') {
      from = fmt(startOfYear(t));
      to = fmt(t);
    }
  }

  // Default if nothing provided
  if (!from || !to) {
    const d = new Date(today);
    d.setDate(d.getDate() - 29);
    from = fmt(d);
    to = fmt(today);
  }

  // Previous period (same length) for comparisons
  const fromD = new Date(from + 'T00:00:00');
  const toD = new Date(to + 'T23:59:59');
  const days = Math.max(1, Math.round((toD - fromD) / (1000 * 60 * 60 * 24)) + 1);

  const prevTo = new Date(fromD);
  prevTo.setDate(prevTo.getDate() - 1);

  const prevFrom = new Date(prevTo);
  prevFrom.setDate(prevFrom.getDate() - (days - 1));

  const prevFromStr = fmt(prevFrom);
  const prevToStr = fmt(prevTo);

  // ---- Build WHERE conditions ----
  const subWhere = [];
  const subParams = {};
  subWhere.push('s.created_at >= :sub_from AND s.created_at <= :sub_to');
  subParams.sub_from = `${from} 00:00:00`;
  subParams.sub_to = `${to} 23:59:59`;

  if (track) {
    subWhere.push('s.track_id = :track');
    subParams.track = track;
  }
  if (sub_status && sub_status !== 'all') {
    subWhere.push('s.status = :sub_status');
    subParams.sub_status = sub_status;
  }

  const subWhereSql = subWhere.length ? `WHERE ${subWhere.join(' AND ')}` : '';

  const txWhere = [];
  const txParams = {};
  txWhere.push('t.created_at >= :tx_from AND t.created_at <= :tx_to');
  txParams.tx_from = `${from} 00:00:00`;
  txParams.tx_to = `${to} 23:59:59`;

  if (tx_status && tx_status !== 'all') {
    txWhere.push('t.status = :tx_status');
    txParams.tx_status = tx_status;
  }

  const txWhereSql = txWhere.length ? `WHERE ${txWhere.join(' AND ')}` : '';

  // Previous period where
  const subWherePrev = [];
  const subPrevParams = { ...subParams };
  subWherePrev.push('s.created_at >= :sub_prev_from AND s.created_at <= :sub_prev_to');
  subPrevParams.sub_prev_from = `${prevFromStr} 00:00:00`;
  subPrevParams.sub_prev_to = `${prevToStr} 23:59:59`;
  if (track) { /* already in subPrevParams.track */ }
  if (sub_status && sub_status !== 'all') { /* already in subPrevParams.sub_status */ }
  const subWherePrevSql = `WHERE ${subWherePrev.join(' AND ')}${track ? ' AND s.track_id = :track' : ''}${(sub_status && sub_status !== 'all') ? ' AND s.status = :sub_status' : ''}`;

  const txWherePrev = [];
  const txPrevParams = { ...txParams };
  txWherePrev.push('t.created_at >= :tx_prev_from AND t.created_at <= :tx_prev_to');
  txPrevParams.tx_prev_from = `${prevFromStr} 00:00:00`;
  txPrevParams.tx_prev_to = `${prevToStr} 23:59:59`;
  const txWherePrevSql = `WHERE ${txWherePrev.join(' AND ')}${(tx_status && tx_status !== 'all') ? ' AND t.status = :tx_status' : ''}`;

  // ---- Helpers for % change ----
  const pct = (cur, prev) => {
    const c = Number(cur || 0);
    const p = Number(prev || 0);
    if (p === 0 && c === 0) return 0;
    if (p === 0) return 100;
    return Math.round(((c - p) / p) * 100);
  };

  try {
    // Dropdown options: tracks list (for filter)
    const [trackOptions] = await req.db.query(`
      SELECT DISTINCT track_id
      FROM subscriptions
      WHERE track_id IS NOT NULL AND track_id <> ''
      ORDER BY track_id ASC
      LIMIT 300
    `);

    // KPIs (current period)
    const [[{ totalUsers }]] = await req.db.query(
      `SELECT COUNT(*) AS totalUsers FROM users WHERE created_at >= :u_from AND created_at <= :u_to`,
      { u_from: `${from} 00:00:00`, u_to: `${to} 23:59:59` }
    );

    const [[{ subsCount }]] = await req.db.query(
      `SELECT COUNT(*) AS subsCount FROM subscriptions s ${subWhereSql}`,
      subParams
    );

    const [[{ salesAmount }]] = await req.db.query(
      `SELECT COALESCE(SUM(t.amount),0) AS salesAmount FROM transactions t ${txWhereSql}`,
      txParams
    );

    // KPIs (previous period)
    const [[{ prevUsers }]] = await req.db.query(
      `SELECT COUNT(*) AS prevUsers FROM users WHERE created_at >= :u_from AND created_at <= :u_to`,
      { u_from: `${prevFromStr} 00:00:00`, u_to: `${prevToStr} 23:59:59` }
    );

    const [[{ prevSubsCount }]] = await req.db.query(
      `SELECT COUNT(*) AS prevSubsCount FROM subscriptions s ${subWherePrevSql}`,
      subPrevParams
    );

    const [[{ prevSalesAmount }]] = await req.db.query(
      `SELECT COALESCE(SUM(t.amount),0) AS prevSalesAmount FROM transactions t ${txWherePrevSql}`,
      txPrevParams
    );

    // Monthly series (range-based; for big brand feel)
    // Group by DATE (daily) if range <= 45 days, else by month
    const useDaily = days <= 45;

    const [subsSeries] = await req.db.query(
      `
      SELECT
        ${useDaily ? "DATE(s.created_at)" : "DATE_FORMAT(s.created_at, '%Y-%m')"} AS x,
        COUNT(*) AS y
      FROM subscriptions s
      ${subWhereSql}
      GROUP BY x
      ORDER BY x
      `,
      subParams
    );

    const [salesSeries] = await req.db.query(
      `
      SELECT
        ${useDaily ? "DATE(t.created_at)" : "DATE_FORMAT(t.created_at, '%Y-%m')"} AS x,
        COALESCE(SUM(t.amount),0) AS y
      FROM transactions t
      ${txWhereSql}
      GROUP BY x
      ORDER BY x
      `,
      txParams
    );

    // Top tracks table (current period)
    const [topTracks] = await req.db.query(
      `
      SELECT s.track_id, COUNT(*) AS cnt
      FROM subscriptions s
      ${subWhereSql}
      GROUP BY s.track_id
      ORDER BY cnt DESC
      LIMIT 10
      `,
      subParams
    );

    // Recent transactions (current period)
    const [recentTxns] = await req.db.query(
      `
      SELECT t.created_at, t.order_id, t.payment_id, t.email, t.amount, t.status, t.method
      FROM transactions t
      ${txWhereSql}
      ORDER BY t.created_at DESC
      LIMIT 12
      `,
      txParams
    );

    const filters = {
      preset,
      from,
      to,
      track,
      sub_status,
      tx_status
    };

    res.render('dashboard', {
      title: 'Admin Dashboard',
      filters,
      ranges: { from, to, prevFrom: prevFromStr, prevTo: prevToStr, days },
      trackOptions: (trackOptions || []).map(r => r.track_id),
      stats: {
        totalUsers,
        subsCount,
        salesAmount,
        deltas: {
          usersPct: pct(totalUsers, prevUsers),
          subsPct: pct(subsCount, prevSubsCount),
          salesPct: pct(salesAmount, prevSalesAmount)
        }
      },
      subsSeries,
      salesSeries,
      topTracks,
      recentTxns
    });
  } catch (err) {
    console.error(err);
    res.render('dashboard', {
      title: 'Admin Dashboard',
      filters: { preset, from, to, track, sub_status, tx_status },
      ranges: { from, to, prevFrom: prevFromStr, prevTo: prevToStr, days },
      trackOptions: [],
      stats: {
        totalUsers: 0,
        subsCount: 0,
        salesAmount: 0,
        deltas: { usersPct: 0, subsPct: 0, salesPct: 0 }
      },
      subsSeries: [],
      salesSeries: [],
      topTracks: [],
      recentTxns: []
    });
  }
});



// ---------- Users (paginated + CRUD) ----------
router.get('/users', requireAuth, async (req, res) => {
  const page = Math.max(parseInt(req.query.page || '1', 10), 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 5), 100);
  const offset = (page - 1) * limit;

  const q = String(req.query.q || '').trim();
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();

  const sort = String(req.query.sort || 'created_at').trim();
  const dir = String(req.query.dir || 'desc').trim().toLowerCase();

  const SORT_MAP = {
    created_at: 'u.created_at',
    name: 'u.name',
    email: 'u.email',
    id: 'u.id'
  };
  const sortSql = SORT_MAP[sort] || 'u.created_at';
  const dirSql = dir === 'asc' ? 'ASC' : 'DESC';

  const where = [];
  const params = { limit, offset };

  if (q) {
    where.push('(u.name LIKE :q OR u.email LIKE :q)');
    params.q = `%${q}%`;
  }
  if (from) {
    where.push('u.created_at >= :from');
    params.from = `${from} 00:00:00`;
  }
  if (to) {
    where.push('u.created_at <= :to');
    params.to = `${to} 23:59:59`;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const filters = { q, from, to, sort, dir, limit };

  try {
    const [[{ total }]] = await req.db.query(
      `SELECT COUNT(*) AS total FROM users u ${whereSql}`,
      params
    );

    const [rows] = await req.db.query(
      `
      SELECT u.id, u.name, u.email, u.created_at
      FROM users u
      ${whereSql}
      ORDER BY ${sortSql} ${dirSql}
      LIMIT :limit OFFSET :offset
      `,
      params
    );

    res.render('users', {
      title: 'User Management',
      users: rows,
      filters,
      pagination: { page, limit, total }
    });
  } catch (err) {
    console.error(err);
    res.render('users', {
      title: 'User Management',
      users: [],
      filters,
      pagination: { page: 1, limit, total: 0 }
    });
  }
});

router.get('/users.csv', requireAuth, async (req, res) => {
  const q = String(req.query.q || '').trim();
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();
  const sort = String(req.query.sort || 'created_at').trim();
  const dir = String(req.query.dir || 'desc').trim().toLowerCase();

  const SORT_MAP = {
    created_at: 'u.created_at',
    name: 'u.name',
    email: 'u.email',
    id: 'u.id'
  };
  const sortSql = SORT_MAP[sort] || 'u.created_at';
  const dirSql = dir === 'asc' ? 'ASC' : 'DESC';

  const where = [];
  const params = {};

  if (q) {
    where.push('(u.name LIKE :q OR u.email LIKE :q)');
    params.q = `%${q}%`;
  }
  if (from) {
    where.push('u.created_at >= :from');
    params.from = `${from} 00:00:00`;
  }
  if (to) {
    where.push('u.created_at <= :to');
    params.to = `${to} 23:59:59`;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  try {
    const [rows] = await req.db.query(
      `
      SELECT u.id, u.name, u.email, u.created_at
      FROM users u
      ${whereSql}
      ORDER BY ${sortSql} ${dirSql}
      LIMIT 10000
      `,
      params
    );

    const header = ['id', 'name', 'email', 'created_at'].map(csvEscape).join(',') + '\n';
    const lines = rows.map(r => [
      r.id,
      r.name,
      r.email,
      r.created_at
    ].map(csvEscape).join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="users.csv"');
    res.send(header + lines);
  } catch (e) {
    console.error(e);
    res.status(500).send('Failed to export CSV');
  }
});


router.post(
  '/users',
  requireAuth,
  requireRole(['super','manager']),
  body('name').notEmpty(),
  body('email').isEmail(),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 chars'),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash('error', errors.array().map(e => e.msg));
      return res.redirect('/admin/users');
    }
    const { name, email, password } = req.body;
    try {
      const password_hash = await bcrypt.hash(password, 10);
      await req.db.query(
        'INSERT INTO users (name, email, password_hash) VALUES (:name, :email, :password_hash)',
        { name, email, password_hash }
      );
      req.flash('success', 'User created');
    } catch (e) {
      console.error(e);
      req.flash('error', 'Could not create user (duplicate email?)');
    }
    res.redirect('/admin/users');
  }
);

router.post(
  '/users/:id',
  requireAuth,
  requireRole(['super','manager']),
  body('name').notEmpty(),
  body('email').isEmail(),
  async (req, res) => {
    const { id } = req.params;
    const { name, email, password } = req.body;
    try {
      if (password && password.trim().length > 0) {
        if (password.length < 6) {
          req.flash('error', 'New password must be at least 6 chars');
          return res.redirect('/admin/users');
        }
        const password_hash = await bcrypt.hash(password, 10);
        await req.db.query(
          'UPDATE users SET name=:name, email=:email, password_hash=:password_hash WHERE id=:id',
          { id, name, email, password_hash }
        );
      } else {
        await req.db.query(
          'UPDATE users SET name=:name, email=:email WHERE id=:id',
          { id, name, email }
        );
      }
      req.flash('success', 'User updated');
    } catch (e) {
      console.error(e);
      req.flash('error', 'Could not update user');
    }
    res.redirect('/admin/users');
  }
);


router.post('/users/:id/delete', requireAuth, requireRole(['super']), async (req, res) => {
  const { id } = req.params
  try { await req.db.query('DELETE FROM users WHERE id=:id', { id }); req.flash('success', 'User deleted') }
  catch (e) { req.flash('error', 'Could not delete user') }
  res.redirect('/admin/users')
})

// ---------- Subscriptions (paginated + CSV + CRUD) ----------
router.get('/subscriptions', requireAuth, async (req, res) => {
  const page = Math.max(parseInt(req.query.page || '1', 10), 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 5), 100);
  const offset = (page - 1) * limit;

  // Filters
  const q = String(req.query.q || '').trim();
  const status = String(req.query.status || '').trim(); // active|expired|cancelled
  const track = String(req.query.track || '').trim();
  const user_id = String(req.query.user_id || '').trim();

  const from = String(req.query.from || '').trim(); // created_at
  const to = String(req.query.to || '').trim();

  const start_from = String(req.query.start_from || '').trim();
  const start_to = String(req.query.start_to || '').trim();

  const end_from = String(req.query.end_from || '').trim();
  const end_to = String(req.query.end_to || '').trim();

  const sort = String(req.query.sort || 'created_at').trim();
  const dir = String(req.query.dir || 'desc').trim().toLowerCase();

  // Safe sort whitelist
  const SORT_MAP = {
    created_at: 's.created_at',
    start_date: 's.start_date',
    end_date: 's.end_date',
    status: 's.status',
    track_id: 's.track_id'
  };
  const sortSql = SORT_MAP[sort] || 's.created_at';
  const dirSql = dir === 'asc' ? 'ASC' : 'DESC';

  // WHERE builder (named params)
  const where = [];
  const params = { limit, offset };

  // Quick search across: subscription id, user name, email, track_id
  if (q) {
    const qMaybeId = Number(q);
    if (Number.isInteger(qMaybeId) && qMaybeId > 0) {
      where.push('(s.id = :qid OR u.name LIKE :q OR u.email LIKE :q OR CAST(s.track_id AS CHAR) LIKE :q)');
      params.qid = qMaybeId;
    } else {
      where.push('(u.name LIKE :q OR u.email LIKE :q OR CAST(s.track_id AS CHAR) LIKE :q)');
    }
    params.q = `%${q}%`;
  }

  // Status
  if (status && ['active', 'expired', 'cancelled'].includes(status)) {
    where.push('s.status = :status');
    params.status = status;
  }

  // Track exact/partial match
  if (track) {
    where.push('CAST(s.track_id AS CHAR) LIKE :track');
    params.track = `%${track}%`;
  }

  // User ID
  if (user_id) {
    const uid = Number(user_id);
    if (Number.isInteger(uid) && uid > 0) {
      where.push('s.user_id = :user_id');
      params.user_id = uid;
    }
  }

  // created_at date range (DATETIME)
  if (from) {
    where.push('s.created_at >= :from');
    params.from = `${from} 00:00:00`;
  }
  if (to) {
    where.push('s.created_at <= :to');
    params.to = `${to} 23:59:59`;
  }

  // start_date range (DATE/DATETIME safe)
  if (start_from) {
    where.push('s.start_date >= :start_from');
    params.start_from = `${start_from} 00:00:00`;
  }
  if (start_to) {
    where.push('s.start_date <= :start_to');
    params.start_to = `${start_to} 23:59:59`;
  }

  // end_date range
  if (end_from) {
    where.push('s.end_date >= :end_from');
    params.end_from = `${end_from} 00:00:00`;
  }
  if (end_to) {
    where.push('s.end_date <= :end_to');
    params.end_to = `${end_to} 23:59:59`;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // Pass filters back to EJS
  const filters = {
    q,
    status,
    track,
    user_id,
    from,
    to,
    start_from,
    start_to,
    end_from,
    end_to,
    sort,
    dir,
    limit
  };

  try {
    // total with SAME WHERE
    const [[{ total }]] = await req.db.query(
      `
      SELECT COUNT(*) AS total
      FROM subscriptions s
      JOIN users u ON u.id = s.user_id
      ${whereSql}
      `,
      params
    );

    // rows with SAME WHERE
    const [rows] = await req.db.query(
      `
      SELECT s.id, u.name AS user_name, u.email,
             s.track_id, s.status, s.start_date, s.end_date, s.created_at, s.user_id
      FROM subscriptions s
      JOIN users u ON u.id = s.user_id
      ${whereSql}
      ORDER BY ${sortSql} ${dirSql}
      LIMIT :limit OFFSET :offset
      `,
      params
    );

    res.render('subscriptions', {
      title: 'Subscription Report',
      subs: rows,
      pagination: { page, limit, total },
      filters
    });
  } catch (err) {
    console.error(err);
    res.render('subscriptions', {
      title: 'Subscription Report',
      subs: [],
      pagination: { page, limit, total: 0 },
      filters
    });
  }
});

router.get('/subscriptions.csv', requireAuth, async (req, res) => {
  // Same filters as the page (but no pagination; capped)
  const q = String(req.query.q || '').trim();
  const status = String(req.query.status || '').trim();
  const track = String(req.query.track || '').trim();
  const user_id = String(req.query.user_id || '').trim();

  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();

  const start_from = String(req.query.start_from || '').trim();
  const start_to = String(req.query.start_to || '').trim();

  const end_from = String(req.query.end_from || '').trim();
  const end_to = String(req.query.end_to || '').trim();

  const sort = String(req.query.sort || 'created_at').trim();
  const dir = String(req.query.dir || 'desc').trim().toLowerCase();

  const SORT_MAP = {
    created_at: 's.created_at',
    start_date: 's.start_date',
    end_date: 's.end_date',
    status: 's.status',
    track_id: 's.track_id'
  };
  const sortSql = SORT_MAP[sort] || 's.created_at';
  const dirSql = dir === 'asc' ? 'ASC' : 'DESC';

  const where = [];
  const params = {};

  if (q) {
    const qMaybeId = Number(q);
    if (Number.isInteger(qMaybeId) && qMaybeId > 0) {
      where.push('(s.id = :qid OR u.name LIKE :q OR u.email LIKE :q OR CAST(s.track_id AS CHAR) LIKE :q)');
      params.qid = qMaybeId;
    } else {
      where.push('(u.name LIKE :q OR u.email LIKE :q OR CAST(s.track_id AS CHAR) LIKE :q)');
    }
    params.q = `%${q}%`;
  }

  if (status && ['active', 'expired', 'cancelled'].includes(status)) {
    where.push('s.status = :status');
    params.status = status;
  }

  if (track) {
    where.push('CAST(s.track_id AS CHAR) LIKE :track');
    params.track = `%${track}%`;
  }

  if (user_id) {
    const uid = Number(user_id);
    if (Number.isInteger(uid) && uid > 0) {
      where.push('s.user_id = :user_id');
      params.user_id = uid;
    }
  }

  if (from) { where.push('s.created_at >= :from'); params.from = `${from} 00:00:00`; }
  if (to) { where.push('s.created_at <= :to'); params.to = `${to} 23:59:59`; }

  if (start_from) { where.push('s.start_date >= :start_from'); params.start_from = `${start_from} 00:00:00`; }
  if (start_to) { where.push('s.start_date <= :start_to'); params.start_to = `${start_to} 23:59:59`; }

  if (end_from) { where.push('s.end_date >= :end_from'); params.end_from = `${end_from} 00:00:00`; }
  if (end_to) { where.push('s.end_date <= :end_to'); params.end_to = `${end_to} 23:59:59`; }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  try {
    const [rows] = await req.db.query(
      `
      SELECT s.id, u.name AS user_name, u.email, s.track_id, s.status, s.start_date, s.end_date, s.created_at
      FROM subscriptions s
      JOIN users u ON u.id = s.user_id
      ${whereSql}
      ORDER BY ${sortSql} ${dirSql}
      LIMIT 10000
      `,
      params
    );

    const header = [
      'id','user_name','email','track_id','status','start_date','end_date','created_at'
    ].map(csvEscape).join(',') + '\n';

    const lines = rows.map(r => [
      r.id,
      r.user_name,
      r.email,
      r.track_id,
      r.status,
      r.start_date || '',
      r.end_date || '',
      r.created_at
    ].map(csvEscape).join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="subscriptions.csv"');
    res.send(header + lines);
  } catch (e) {
    console.error(e);
    res.status(500).send('Failed to export CSV');
  }
});


router.post('/subscriptions', requireAuth, requireRole(['super','manager']),
  body('user_id').isInt(), body('track').notEmpty(), body('status').isIn(['active','expired','cancelled']).optional(),
  async (req, res) => {
    const { user_id, track, status, start_date, end_date } = req.body
    try {
      await req.db.query('INSERT INTO subscriptions (user_id, track_id, status, start_date, end_date) VALUES (:user_id, :track, :status, :start_date, :end_date)', {
        user_id, track, status: status || 'active', start_date: start_date || null, end_date: end_date || null
      })
      req.flash('success', 'Subscription created')
    } catch (e) { console.error(e); req.flash('error', 'Could not create subscription') }
    res.redirect('/admin/subscriptions')
  })
router.post('/subscriptions/:id', requireAuth, requireRole(['super','manager']),
  async (req, res) => {
    const { id } = req.params
    const { track, status, start_date, end_date } = req.body
    try {
      await req.db.query('UPDATE subscriptions SET track_id=:track, status=:status, start_date=:start_date, end_date=:end_date WHERE id=:id', {
        id, track, status, start_date: start_date || null, end_date: end_date || null
      })
      req.flash('success', 'Subscription updated')
    } catch (e) { console.error(e); req.flash('error', 'Could not update subscription') }
    res.redirect('/admin/subscriptions')
  })
router.post('/subscriptions/:id/delete', requireAuth, requireRole(['super']), async (req, res) => {
  const { id } = req.params
  try { await req.db.query('DELETE FROM subscriptions WHERE id=:id', { id }); req.flash('success', 'Subscription deleted') }
  catch (e) { console.error(e); req.flash('error', 'Could not delete subscription') }
  res.redirect('/admin/subscriptions')
})

// ---------- Transactions (paginated + filters + CSV) ----------
router.get('/transactions', requireAuth, async (req, res) => {
  const page = Math.max(parseInt(req.query.page || '1', 10), 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 5), 200);
  const offset = (page - 1) * limit;

  // Filters
  const q = String(req.query.q || '').trim();
  const status = String(req.query.status || '').trim();
  const method = String(req.query.method || '').trim();
  const from = String(req.query.from || '').trim(); // YYYY-MM-DD
  const to = String(req.query.to || '').trim();     // YYYY-MM-DD
  const currency = String(req.query.currency || '').trim();

  const min_amount = String(req.query.min_amount || '').trim(); // rupees
  const max_amount = String(req.query.max_amount || '').trim(); // rupees

  const sort = String(req.query.sort || 'created_at').trim();
  const dir = String(req.query.dir || 'desc').trim().toLowerCase();

  // Safe sorting
  const SORT_MAP = {
    created_at: 't.created_at',
    amount: 't.amount',
    status: 't.status',
    method: 't.method'
  };
  const sortSql = SORT_MAP[sort] || 't.created_at';
  const dirSql = dir === 'asc' ? 'ASC' : 'DESC';

  // Build WHERE (named params)
  const where = [];
  const params = { limit, offset };

  // Search
  if (q) {
    where.push('(t.order_id LIKE :q OR t.payment_id LIKE :q OR t.receipt LIKE :q OR t.email LIKE :q)');
    params.q = `%${q}%`;
  }

  // Status (optional whitelist)
  if (status && ['created', 'authorized', 'captured', 'failed', 'refunded'].includes(status)) {
    where.push('t.status = :status');
    params.status = status;
  }

  // Method
  if (method) {
    where.push('t.method = :method');
    params.method = method;
  }

  // Currency
  if (currency) {
    where.push('t.currency = :currency');
    params.currency = currency;
  }

  // Date range (created_at is DATETIME)
  // IMPORTANT FIX: avoid DATE(created_at) which can break index usage and can feel "off"
  if (from) {
    where.push('t.created_at >= :from');
    params.from = `${from} 00:00:00`;
  }
  if (to) {
    where.push('t.created_at <= :to');
    params.to = `${to} 23:59:59`;
  }

  // Amount range (assuming t.amount stored in rupees; if paise, adjust here)
  const minNum = min_amount ? Number(min_amount) : null;
  const maxNum = max_amount ? Number(max_amount) : null;
  if (Number.isFinite(minNum)) {
    where.push('t.amount >= :min_amount');
    params.min_amount = minNum;
  }
  if (Number.isFinite(maxNum)) {
    where.push('t.amount <= :max_amount');
    params.max_amount = maxNum;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const filters = {
    q,
    status,
    method,
    from,
    to,
    currency,
    min_amount,
    max_amount,
    sort,
    dir,
    limit
  };

  try {
    // TOTAL (same WHERE, same alias)
    const [[{ total }]] = await req.db.query(
      `SELECT COUNT(*) AS total FROM transactions t ${whereSql}`,
      params
    );

    // ROWS (same WHERE)
    const [rows] = await req.db.query(
      `
      SELECT t.id, t.order_id, t.payment_id, t.receipt, t.email,
             t.amount, t.currency, t.status, t.method, t.created_at
      FROM transactions t
      ${whereSql}
      ORDER BY ${sortSql} ${dirSql}
      LIMIT :limit OFFSET :offset
      `,
      params
    );

    res.render('transactions', {
      title: 'Transaction Report',
      txns: rows,
      filters,
      pagination: { page, limit, total }
    });
  } catch (err) {
    console.error(err);
    res.render('transactions', {
      title: 'Transaction Report',
      txns: [],
      filters,
      pagination: { page, limit, total: 0 }
    });
  }
});

router.get('/transactions.csv', requireAuth, async (req, res) => {
  // Same filters as list (no pagination, capped)
  const q = String(req.query.q || '').trim();
  const status = String(req.query.status || '').trim();
  const method = String(req.query.method || '').trim();
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();
  const currency = String(req.query.currency || '').trim();
  const min_amount = String(req.query.min_amount || '').trim();
  const max_amount = String(req.query.max_amount || '').trim();

  const sort = String(req.query.sort || 'created_at').trim();
  const dir = String(req.query.dir || 'desc').trim().toLowerCase();

  const SORT_MAP = {
    created_at: 't.created_at',
    amount: 't.amount',
    status: 't.status',
    method: 't.method'
  };
  const sortSql = SORT_MAP[sort] || 't.created_at';
  const dirSql = dir === 'asc' ? 'ASC' : 'DESC';

  const where = [];
  const params = {};

  if (q) {
    where.push('(t.order_id LIKE :q OR t.payment_id LIKE :q OR t.receipt LIKE :q OR t.email LIKE :q)');
    params.q = `%${q}%`;
  }
  if (status && ['created', 'authorized', 'captured', 'failed', 'refunded'].includes(status)) {
    where.push('t.status = :status');
    params.status = status;
  }
  if (method) {
    where.push('t.method = :method');
    params.method = method;
  }
  if (currency) {
    where.push('t.currency = :currency');
    params.currency = currency;
  }

  if (from) {
    where.push('t.created_at >= :from');
    params.from = `${from} 00:00:00`;
  }
  if (to) {
    where.push('t.created_at <= :to');
    params.to = `${to} 23:59:59`;
  }

  const minNum = min_amount ? Number(min_amount) : null;
  const maxNum = max_amount ? Number(max_amount) : null;
  if (Number.isFinite(minNum)) {
    where.push('t.amount >= :min_amount');
    params.min_amount = minNum;
  }
  if (Number.isFinite(maxNum)) {
    where.push('t.amount <= :max_amount');
    params.max_amount = maxNum;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  try {
    const [rows] = await req.db.query(
      `
      SELECT t.created_at, t.order_id, t.payment_id, t.receipt, t.email,
             t.amount, t.currency, t.status, t.method
      FROM transactions t
      ${whereSql}
      ORDER BY ${sortSql} ${dirSql}
      LIMIT 10000
      `,
      params
    );

    const header = [
      'created_at','order_id','payment_id','receipt','email','amount','currency','status','method'
    ].map(csvEscape).join(',') + '\n';

    const lines = rows.map(r => [
      r.created_at,
      r.order_id,
      r.payment_id || '',
      r.receipt || '',
      r.email || '',
      r.amount,
      r.currency || 'INR',
      r.status,
      r.method || ''
    ].map(csvEscape).join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="transactions.csv"');
    res.send(header + lines);
  } catch (e) {
    console.error(e);
    res.status(500).send('Failed to export CSV');
  }
});


// -------------------- CATEGORY CRUD --------------------
const { param, query } = require('express-validator');

const catStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '..', 'public', 'uploads', 'categories'));
  },
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '.png').toLowerCase();
    cb(null, 'cat_' + Date.now() + ext);
  }
});
const imageFilter = (req, file, cb) => {
  const ok = ['image/png','image/jpeg','image/webp'].includes(file.mimetype)
           || /\.(png|jpe?g|webp)$/i.test(file.originalname);
  if (!ok) return cb(new Error('Only PNG/JPG/WEBP images allowed'));
  cb(null, true);
};
const uploadCat = multer({ storage: catStorage, fileFilter: imageFilter, limits: { fileSize: 10 * 1024 * 1024 }});



// helper: slugify
const slugify = (s) => String(s || '')
  .toLowerCase()
  .trim()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

// router.get('/categories', requireAuth, async (req, res) => {
//   const page = Math.max(parseInt(req.query.page || '1', 10), 1);
//   const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 5), 100);
//   const offset = (page - 1) * limit;

//   try {
//     const [[{ total }]] = await req.db.query('SELECT COUNT(*) AS total FROM categories');

//     const [rows] = await req.db.query(
//       `
//       SELECT id, name, slug, description, created_at, thumbnail_path, sort_order
//       FROM categories
//       ORDER BY sort_order ASC, created_at DESC
//       LIMIT :limit OFFSET :offset
//       `,
//       { limit, offset }
//     );

//     res.render('categories', {
//       title: 'Categories',
//       categories: rows,
//       pagination: { page, limit, total }
//     });
//   } catch (e) {
//     console.error(e);
//     res.render('categories', {
//       title: 'Categories',
//       categories: [],
//       pagination: { page: 1, limit: 20, total: 0 }
//     });
//   }
// });


// router.post(
//   '/categories',
//   requireAuth,
//   requireRole(['super','manager']),
//   uploadCat.single('thumb'),
//   body('name').notEmpty().withMessage('Name required'),
//   async (req, res) => {
//     const errors = validationResult(req);
//     if (!errors.isEmpty()) {
//       req.flash('error', errors.array().map(e => e.msg));
//       return res.redirect('/admin/categories');
//     }
//     const { name, description } = req.body;
//     const slug = slugify(name);
//     const thumbnail_path = req.file ? `/uploads/categories/${req.file.filename}` : null;

//     try {
//       await req.db.query(
//         'INSERT INTO categories (name, slug, description, thumbnail_path) VALUES (:name, :slug, :description, :thumbnail_path)',
//         { name, slug, description: description || null, thumbnail_path }
//       );
//       req.flash('success', 'Category created');
//     } catch (e) {
//       console.error(e);
//       req.flash('error', 'Failed to create category (duplicate slug?)');
//     }
//     res.redirect('/admin/categories');
//   }
// );


// router.post(
//   '/categories/:id',
//   requireAuth,
//   requireRole(['super','manager']),
//   uploadCat.single('thumb'),
//   param('id').isInt(),
//   body('name').notEmpty(),
//   async (req, res) => {
//     const { id } = req.params;
//     const { name, description } = req.body;
//     const slug = slugify(name);

//     try {
//       if (req.file) {
//         const [rows] = await req.db.query('SELECT thumbnail_path FROM categories WHERE id=:id', { id });
//         const old = rows[0]?.thumbnail_path || null;
//         const thumbnail_path = `/uploads/categories/${req.file.filename}`;

//         await req.db.query(
//           `UPDATE categories
//              SET name=:name, slug=:slug, description=:description, thumbnail_path=:thumbnail_path
//            WHERE id=:id`,
//           { id, name, slug, description: description || null, thumbnail_path }
//         );

//         if (old) fs.unlink(path.join(__dirname, '..', 'public', old), () => {});
//       } else {
//         await req.db.query(
//           `UPDATE categories
//              SET name=:name, slug=:slug, description=:description
//            WHERE id=:id`,
//           { id, name, slug, description: description || null }
//         );
//       }

//       req.flash('success', 'Category updated');
//     } catch (e) {
//       console.error(e);
//       req.flash('error', 'Failed to update category');
//     }
//     res.redirect('/admin/categories');
//   }
// );

// router.post(
//   '/categories/:id/delete',
//   requireAuth,
//   requireRole(['super']),
//   param('id').isInt(),
//   async (req, res) => {
//     const { id } = req.params;
//     try {
//       // Will error if tracks exist with this category due to FK (RESTRICT). Handle as needed.
//       await req.db.query('DELETE FROM categories WHERE id=:id', { id });
//       req.flash('success', 'Category deleted');
//     } catch (e) {
//       console.error(e);
//       req.flash('error', 'Cannot delete: category has linked tracks');
//     }
//     res.redirect('/admin/categories');
//   }
// );



router.get('/categories', requireAuth, async (req, res) => {
  const page = Math.max(parseInt(req.query.page || '1', 10), 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10), 5), 100);
  const offset = (page - 1) * limit;

  try {
    const [[{ total }]] = await req.db.query('SELECT COUNT(*) AS total FROM categories');

    const [rows] = await req.db.query(
      `
      SELECT id, name, slug, description, created_at, thumbnail_path, sort_order
      FROM categories
      ORDER BY sort_order ASC, created_at DESC
      LIMIT :limit OFFSET :offset
      `,
      { limit, offset }
    );

    res.render('categories', {
      title: 'Categories',
      categories: rows,
      pagination: { page, limit, total }
    });
  } catch (e) {
    console.error(e);
    res.render('categories', {
      title: 'Categories',
      categories: [],
      pagination: { page: 1, limit: 20, total: 0 }
    });
  }
});

// -----------------------------
// POST: Create Category
// - NEW: assigns sort_order = MAX(sort_order)+1 (appends to end)
// -----------------------------
router.post(
  '/categories',
  requireAuth,
  requireRole(['super', 'manager']),
  uploadCat.single('thumb'),
  body('name').notEmpty().withMessage('Name required'),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash('error', errors.array().map(e => e.msg));
      return res.redirect('/admin/categories');
    }

    const { name, description } = req.body;
    const slug = slugify(name);
    const thumbnail_path = req.file ? `/uploads/categories/${req.file.filename}` : null;

    try {
      // append to the end
      const [[{ maxOrder }]] = await req.db.query(
        'SELECT COALESCE(MAX(sort_order), 0) AS maxOrder FROM categories'
      );
      const sort_order = Number(maxOrder || 0) + 1;

      await req.db.query(
        `
        INSERT INTO categories (name, slug, description, thumbnail_path, sort_order)
        VALUES (:name, :slug, :description, :thumbnail_path, :sort_order)
        `,
        {
          name,
          slug,
          description: (description || '').trim() || null,
          thumbnail_path,
          sort_order
        }
      );

      req.flash('success', 'Category created');
    } catch (e) {
      console.error(e);
      req.flash('error', 'Failed to create category (duplicate slug?)');
    }

    res.redirect('/admin/categories');
  }
);


router.post(
  '/categories/order',
  requireAuth,
  requireRole(['super', 'manager']),
  async (req, res) => {

    console.log('req.body',req.body)

    try {
      const order = Array.isArray(req.body.order) ? req.body.order : [];
      if (!order.length) return res.status(400).json({ error: 'No order provided' });

      // Validate payload
      const seen = new Set();
      for (const item of order) {
        const id = Number(item?.id);
        const sort_order = Number(item?.sort_order);

        if (!Number.isInteger(id) || !Number.isInteger(sort_order) || sort_order < 1) {
          return res.status(400).json({ error: 'Invalid payload' });
        }
        if (seen.has(id)) return res.status(400).json({ error: 'Duplicate id in payload' });
        seen.add(id);
      }

      // Transaction (mysql2 pool supports getConnection)
      const conn = await req.db.getConnection();
      try {
        await conn.beginTransaction();

        for (const item of order) {
          await conn.query(
            'UPDATE categories SET sort_order = :sort_order WHERE id = :id',
            { id: Number(item.id), sort_order: Number(item.sort_order) }
          );
        }

        await conn.commit();
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }

      return res.json({ ok: true });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Failed to save category order' });
    }
  }
);


// -----------------------------
// POST: Update Category (no change to ordering)
// -----------------------------
router.post(
  '/categories/:id',
  requireAuth,
  requireRole(['super', 'manager']),
  uploadCat.single('thumb'),
  param('id').isInt(),
  body('name').notEmpty(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash('error', errors.array().map(e => e.msg));
      return res.redirect('/admin/categories');
    }

    const id = Number(req.params.id);
    const { name, description } = req.body;
    const slug = slugify(name);

    try {
      if (req.file) {
        const [rows] = await req.db.query(
          'SELECT thumbnail_path FROM categories WHERE id = :id',
          { id }
        );

        const old = rows[0]?.thumbnail_path || null;
        const thumbnail_path = `/uploads/categories/${req.file.filename}`;

        await req.db.query(
          `
          UPDATE categories
             SET name=:name,
                 slug=:slug,
                 description=:description,
                 thumbnail_path=:thumbnail_path
           WHERE id=:id
          `,
          {
            id,
            name,
            slug,
            description: (description || '').trim() || null,
            thumbnail_path
          }
        );

        // delete old file if exists
        if (old) {
          const oldAbs = path.join(process.cwd(), 'public', old.replace(/^\//, ''));
          fs.unlink(oldAbs, () => {});
        }
      } else {
        await req.db.query(
          `
          UPDATE categories
             SET name=:name,
                 slug=:slug,
                 description=:description
           WHERE id=:id
          `,
          {
            id,
            name,
            slug,
            description: (description || '').trim() || null
          }
        );
      }

      req.flash('success', 'Category updated');
    } catch (e) {
      console.error(e);
      req.flash('error', 'Failed to update category');
    }

    res.redirect('/admin/categories');
  }
);

// -----------------------------
// POST: Delete Category (unchanged)
// -----------------------------
router.post(
  '/categories/:id/delete',
  requireAuth,
  requireRole(['super']),
  param('id').isInt(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash('error', 'Invalid category id');
      return res.redirect('/admin/categories');
    }

    const id = Number(req.params.id);

    try {
      await req.db.query('DELETE FROM categories WHERE id=:id', { id });
      req.flash('success', 'Category deleted');
    } catch (e) {
      console.error(e);
      req.flash('error', 'Cannot delete: category has linked tracks');
    }

    res.redirect('/admin/categories');
  }
);

// -----------------------------
// POST: Save Category Order (NEW)
// Endpoint used by drag & drop UI.
// Body: { order: [{ id: 1, sort_order: 1 }, ...] }
// -----------------------------




// Multer storage for MP3s
const trackStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '..', 'public', 'uploads', 'tracks'));
  },
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || (file.fieldname === 'mp3' ? '.mp3' : '.png')).toLowerCase();
    const prefix = file.fieldname === 'mp3' ? 'track_' : 'track_thumb_';
    cb(null, prefix + Date.now() + ext);
  }
});
const trackFilter = (req, file, cb) => {
  const isMp3 = file.fieldname === 'mp3' && (file.mimetype === 'audio/mpeg' || /\.mp3$/i.test(file.originalname));
  const isImg = file.fieldname === 'thumb' && (['image/png','image/jpeg','image/webp'].includes(file.mimetype) || /\.(png|jpe?g|webp)$/i.test(file.originalname));
  if (!isMp3 && !isImg) return cb(new Error('Invalid file type'));
  cb(null, true);
};



const uploadTrack = multer({
  storage: trackStorage,
  fileFilter: trackFilter,
  limits: { fileSize: 200 * 1024 * 1024 } // 50MB
});


// -------------------- TRACK CRUD --------------------
// Price is submitted in INR (e.g. 1499.00), stored as integer paise (149900)
const toPaise = (inr) => {
  const n = parseFloat(String(inr || '0').replace(/,/g, ''));
  if (isNaN(n)) return 0;
  return Math.round(n * 100);
};

// router.get('/tracks', requireAuth, async (req, res) => {
//   const page = Math.max(parseInt(req.query.page || '1'), 1);
//   const limit = Math.min(Math.max(parseInt(req.query.limit || '20'), 5), 100);
//   const offset = (page - 1) * limit;

//   try {
//     const [[{ total }]] = await req.db.query('SELECT COUNT(*) AS total FROM tracks');
//     const [cats] = await req.db.query('SELECT id, name FROM categories ORDER BY name ASC');
//     const [rows] = await req.db.query(`
//       SELECT t.id, t.title, t.description, t.mp3_path, t.thumbnail_path,
//        t.price_paise, t.status, t.category_id, c.name AS category_name, t.created_at
// FROM tracks t
// JOIN categories c ON c.id = t.category_id
//       ORDER BY t.created_at DESC
//       LIMIT :limit OFFSET :offset
//     `, { limit, offset });

//     res.render('tracks', {
//       title: 'Play Tracks',
//       tracks: rows,
//       categories: cats,
//       pagination: { page, limit, total }
//     });
//   } catch (e) {
//     console.error(e);
//     res.render('tracks', {
//       title: 'Play Tracks',
//       tracks: [],
//       categories: [],
//       pagination: { page: 1, limit: 20, total: 0 }
//     });
//   }
// });

// router.post(
//   '/tracks',
//   requireAuth,
//   requireRole(['super','manager']),
//   uploadTrack.fields([{ name: 'mp3', maxCount: 1 }, { name: 'thumb', maxCount: 1 }]),
//   body('category_id').isInt().withMessage('Category required'),
//   body('title').notEmpty().withMessage('Title required'),
//   body('price_inr').notEmpty().withMessage('Price required'),
//   async (req, res) => {
//     const errors = validationResult(req);
//     if (!errors.isEmpty()) {
//       req.flash('error', errors.array().map(e => e.msg));
//       return res.redirect('/admin/tracks');
//     }

//     const { category_id, title, description, price_inr, status } = req.body;
//     const price_paise = toPaise(price_inr);
//     const mp3_file = req.files?.mp3?.[0];
//     const thumb_file = req.files?.thumb?.[0];

//     const mp3_path = mp3_file ? `/uploads/tracks/${mp3_file.filename}` : null;
//     const thumbnail_path = thumb_file ? `/uploads/tracks/${thumb_file.filename}` : null;

//     try {
//       await req.db.query(
//         `INSERT INTO tracks (category_id, title, description, mp3_path, thumbnail_path, price_paise, status)
//          VALUES (:category_id, :title, :description, :mp3_path, :thumbnail_path, :price_paise, :status)`,
//         { category_id, title, description: description || null, mp3_path, thumbnail_path, price_paise, status: status || 'active' }
//       );
//       req.flash('success', 'Track created');
//     } catch (e) {
//       console.error(e);
//       req.flash('error', 'Failed to create track');
//     }
//     res.redirect('/admin/tracks');
//   }
// );

// router.post(
//   '/tracks/:id',
//   requireAuth,
//   requireRole(['super','manager']),
//   uploadTrack.fields([{ name: 'mp3', maxCount: 1 }, { name: 'thumb', maxCount: 1 }]),
//   param('id').isInt(),
//   body('category_id').isInt(),
//   body('title').notEmpty(),
//   body('price_inr').notEmpty(),
//   async (req, res) => {
//     const { id } = req.params;
//     const { category_id, title, description, price_inr, status } = req.body;
//     const price_paise = toPaise(price_inr);

//     const mp3_file = req.files?.mp3?.[0];
//     const thumb_file = req.files?.thumb?.[0];

//     const [prevRows] = await req.db.query('SELECT mp3_path, thumbnail_path FROM tracks WHERE id=:id', { id });
//     const prev = prevRows[0] || {};

//     const newMp3Path = mp3_file ? `/uploads/tracks/${mp3_file.filename}` : null;
//     const newThumbPath = thumb_file ? `/uploads/tracks/${thumb_file.filename}` : null;

//     try {
//       if (newMp3Path || newThumbPath) {
//         await req.db.query(
//           `UPDATE tracks
//            SET category_id=:category_id, title=:title, description=:description,
//                mp3_path=COALESCE(:mp3_path, mp3_path),
//                thumbnail_path=COALESCE(:thumbnail_path, thumbnail_path),
//                price_paise=:price_paise, status=:status
//            WHERE id=:id`,
//           {
//             id, category_id, title, description: description || null,
//             mp3_path: newMp3Path, thumbnail_path: newThumbPath,
//             price_paise, status
//           }
//         );
//         // delete replaced files
//         if (newMp3Path && prev.mp3_path) fs.unlink(path.join(__dirname, '..', 'public', prev.mp3_path), () => {});
//         if (newThumbPath && prev.thumbnail_path) fs.unlink(path.join(__dirname, '..', 'public', prev.thumbnail_path), () => {});
//       } else {
//         await req.db.query(
//           `UPDATE tracks
//            SET category_id=:category_id, title=:title, description=:description,
//                price_paise=:price_paise, status=:status
//            WHERE id=:id`,
//           { id, category_id, title, description: description || null, price_paise, status }
//         );
//       }

//       req.flash('success', 'Track updated');
//     } catch (e) {
//       console.error(e);
//       req.flash('error', 'Failed to update track');
//     }
//     res.redirect('/admin/tracks');
//   }
// );


// router.post(
//   '/tracks/:id/delete',
//   requireAuth,
//   requireRole(['super']),
//   param('id').isInt(),
//   async (req, res) => {
//     const { id } = req.params;
//     try {
//       await req.db.query('DELETE FROM tracks WHERE id=:id', { id });
//       req.flash('success', 'Track deleted');
//     } catch (e) {
//       console.error(e);
//       req.flash('error', 'Failed to delete track');
//     }
//     res.redirect('/admin/tracks');
//   }
// );


router.get('/tracks', requireAuth, async (req, res) => {
  const page = Math.max(parseInt(req.query.page || '1', 10), 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 5), 100);
  const offset = (page - 1) * limit;

  // Filters
  const selectedCategoryId = Number(req.query.category_id || 0);
  const q = String(req.query.q || '').trim();
  const type = String(req.query.type || 'all').trim(); // all | free | premium
  const date_from = String(req.query.date_from || '').trim(); // YYYY-MM-DD
  const date_to = String(req.query.date_to || '').trim();     // YYYY-MM-DD

  // Build WHERE dynamically (safe with named params)
  const where = [];
  const params = { limit, offset };

  // Category
  if (selectedCategoryId > 0) {
    where.push('t.category_id = :category_id');
    params.category_id = selectedCategoryId;
  }

  // Name (title) search
  if (q) {
    where.push('t.title LIKE :q');
    params.q = `%${q}%`;
  }

  // Type filter (free/premium)
  if (type === 'free') {
    where.push('t.price_paise = 0');
  } else if (type === 'premium') {
    where.push('t.price_paise > 0');
  }

  // Date range (created_at)
  // created_at is DATETIME, so:
  // - date_from uses 00:00:00
  // - date_to uses 23:59:59
  if (date_from) {
    where.push('t.created_at >= :date_from');
    params.date_from = `${date_from} 00:00:00`;
  }
  if (date_to) {
    where.push('t.created_at <= :date_to');
    params.date_to = `${date_to} 23:59:59`;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  try {
    const [cats] = await req.db.query(
      'SELECT id, name FROM categories ORDER BY sort_order ASC, name ASC'
    );

    // TOTAL (must use same WHERE)
    const [[{ total }]] = await req.db.query(
      `
      SELECT COUNT(*) AS total
      FROM tracks t
      ${whereSql}
      `,
      params
    );

    // ROWS (same WHERE)
    const [rows] = await req.db.query(
      `
      SELECT t.id, t.title, t.description, t.mp3_path, t.thumbnail_path,
             t.price_paise, t.status, t.category_id, c.name AS category_name,
             t.created_at, t.sort_order
      FROM tracks t
      JOIN categories c ON c.id = t.category_id
      ${whereSql}
      ORDER BY
        t.category_id ASC,
        t.sort_order ASC,
        t.created_at DESC
      LIMIT :limit OFFSET :offset
      `,
      params
    );

    res.render('tracks', {
      title: 'Play Tracks',
      tracks: rows,
      categories: cats,
      selectedCategoryId,
      pagination: { page, limit, total },

      // Pass filter values back to EJS (so inputs stay filled)
      q,
      type,
      date_from,
      date_to
    });
  } catch (e) {
    console.error(e);
    res.render('tracks', {
      title: 'Play Tracks',
      tracks: [],
      categories: [],
      selectedCategoryId: 0,
      pagination: { page: 1, limit: 20, total: 0 },

      q: '',
      type: 'all',
      date_from: '',
      date_to: ''
    });
  }
});


/**
 * IMPORTANT: Put reorder route BEFORE /tracks/:id
 * POST /admin/tracks/order
 * body: { category_id: 12, order: [{id, sort_order}, ...] }
 */
router.post(
  '/tracks/order',
  requireAuth,
  requireRole(['super', 'manager']),
  async (req, res) => {
    try {
      const category_id = Number(req.body.category_id);
      const order = Array.isArray(req.body.order) ? req.body.order : [];

      if (!Number.isInteger(category_id) || category_id < 1) {
        return res.status(400).json({ error: 'category_id required' });
      }
      if (!order.length) return res.status(400).json({ error: 'No order provided' });

      // Validate payload
      const seen = new Set();
      for (const item of order) {
        const id = Number(item?.id);
        const sort_order = Number(item?.sort_order);

        if (!Number.isInteger(id) || !Number.isInteger(sort_order) || sort_order < 1) {
          return res.status(400).json({ error: 'Invalid payload' });
        }
        if (seen.has(id)) return res.status(400).json({ error: 'Duplicate id in payload' });
        seen.add(id);
      }

      const conn = await req.db.getConnection();
      try {
        await conn.beginTransaction();

        // Safety: only update tracks that belong to this category
        for (const item of order) {
          await conn.query(
            `
            UPDATE tracks
            SET sort_order = :sort_order
            WHERE id = :id AND category_id = :category_id
            `,
            {
              id: Number(item.id),
              sort_order: Number(item.sort_order),
              category_id
            }
          );
        }

        await conn.commit();
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }

      return res.json({ ok: true });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Failed to save track order' });
    }
  }
);

router.post(
  '/tracks',
  requireAuth,
  requireRole(['super', 'manager']),
  uploadTrack.fields([{ name: 'mp3', maxCount: 1 }, { name: 'thumb', maxCount: 1 }]),
  body('category_id').isInt().withMessage('Category required'),
  body('title').notEmpty().withMessage('Title required'),
  body('price_inr').notEmpty().withMessage('Price required'),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash('error', errors.array().map(e => e.msg));
      return res.redirect('/admin/tracks');
    }

    const { category_id, title, description, price_inr, status } = req.body;
    const catId = Number(category_id);
    const price_paise = toPaise(price_inr);

    const mp3_file = req.files?.mp3?.[0];
    const thumb_file = req.files?.thumb?.[0];

    const mp3_path = mp3_file ? `/uploads/tracks/${mp3_file.filename}` : null;
    const thumbnail_path = thumb_file ? `/uploads/tracks/${thumb_file.filename}` : null;

    try {
      // Append to end within this category
      const [[{ maxOrder }]] = await req.db.query(
        'SELECT COALESCE(MAX(sort_order), 0) AS maxOrder FROM tracks WHERE category_id = :category_id',
        { category_id: catId }
      );
      const sort_order = Number(maxOrder || 0) + 1;

      await req.db.query(
        `INSERT INTO tracks (category_id, title, description, mp3_path, thumbnail_path, price_paise, status, sort_order)
         VALUES (:category_id, :title, :description, :mp3_path, :thumbnail_path, :price_paise, :status, :sort_order)`,
        {
          category_id: catId,
          title,
          description: description || null,
          mp3_path,
          thumbnail_path,
          price_paise,
          status: status || 'active',
          sort_order
        }
      );
      req.flash('success', 'Track created');
    } catch (e) {
      console.error(e);
      req.flash('error', 'Failed to create track');
    }
    res.redirect(`/admin/tracks?category_id=${catId}`);
  }
);

router.post(
  '/tracks/:id',
  requireAuth,
  requireRole(['super', 'manager']),
  uploadTrack.fields([{ name: 'mp3', maxCount: 1 }, { name: 'thumb', maxCount: 1 }]),
  param('id').isInt(),
  body('category_id').isInt(),
  body('title').notEmpty(),
  body('price_inr').notEmpty(),
  async (req, res) => {
    const { id } = req.params;
    const { category_id, title, description, price_inr, status } = req.body;
    const catId = Number(category_id);
    const price_paise = toPaise(price_inr);

    const mp3_file = req.files?.mp3?.[0];
    const thumb_file = req.files?.thumb?.[0];

    const [prevRows] = await req.db.query('SELECT mp3_path, thumbnail_path FROM tracks WHERE id=:id', { id });
    const prev = prevRows[0] || {};

    const newMp3Path = mp3_file ? `/uploads/tracks/${mp3_file.filename}` : null;
    const newThumbPath = thumb_file ? `/uploads/tracks/${thumb_file.filename}` : null;

    try {
      if (newMp3Path || newThumbPath) {
        await req.db.query(
          `UPDATE tracks
           SET category_id=:category_id, title=:title, description=:description,
               mp3_path=COALESCE(:mp3_path, mp3_path),
               thumbnail_path=COALESCE(:thumbnail_path, thumbnail_path),
               price_paise=:price_paise, status=:status
           WHERE id=:id`,
          {
            id,
            category_id: catId,
            title,
            description: description || null,
            mp3_path: newMp3Path,
            thumbnail_path: newThumbPath,
            price_paise,
            status
          }
        );

        if (newMp3Path && prev.mp3_path) fs.unlink(path.join(__dirname, '..', 'public', prev.mp3_path), () => {});
        if (newThumbPath && prev.thumbnail_path) fs.unlink(path.join(__dirname, '..', 'public', prev.thumbnail_path), () => {});
      } else {
        await req.db.query(
          `UPDATE tracks
           SET category_id=:category_id, title=:title, description=:description,
               price_paise=:price_paise, status=:status
           WHERE id=:id`,
          { id, category_id: catId, title, description: description || null, price_paise, status }
        );
      }

      req.flash('success', 'Track updated');
    } catch (e) {
      console.error(e);
      req.flash('error', 'Failed to update track');
    }
    res.redirect(`/admin/tracks?category_id=${catId}`);
  }
);

router.post(
  '/tracks/:id/delete',
  requireAuth,
  requireRole(['super']),
  param('id').isInt(),
  async (req, res) => {
    const { id } = req.params;

    try {
      const [rows] = await req.db.query('SELECT category_id FROM tracks WHERE id = :id', { id });
      const catId = rows[0]?.category_id || 0;

      await req.db.query('DELETE FROM tracks WHERE id=:id', { id });
      req.flash('success', 'Track deleted');

      return res.redirect(catId ? `/admin/tracks?category_id=${catId}` : '/admin/tracks');
    } catch (e) {
      console.error(e);
      req.flash('error', 'Failed to delete track');
      res.redirect('/admin/tracks');
    }
  }
);




// -------------------- MASTER CREATION (CODES) --------------------
// NOTE: We are NOT using `crypto`.
// We use bcrypt salt + timestamp + Math.random to generate a readable code.

function generateMasterCode() {
  // bcrypt salt looks like: $2a$10$....(22 chars salt)....
  // We'll hash a random-ish seed and then pick clean characters.
  const seed = `${Date.now()}-${Math.random()}-${Math.random()}`;

  // genSaltSync itself uses secure randomness internally (bcryptjs implementation)
  const salt = bcrypt.genSaltSync(10);

  // create a hash, then strip non-alphanumerics and uppercase it
  const hash = bcrypt.hashSync(seed, salt);
  const clean = hash.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

  // Ensure enough length
  const a = clean.slice(0, 6);
  const b = clean.slice(6, 10);

  // Example: ITORUS-9F3KX2-7Q1P
  return `IVORTEX-${a}-${b}`;
}

router.get(
  '/masters',
  requireAuth,
  requireRole(['super', 'manager']),
  async (req, res) => {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 5), 100);
    const offset = (page - 1) * limit;

    const q = String(req.query.q || '').trim();
    const status = String(req.query.status || 'all').trim(); // all|active|inactive
    const valid = String(req.query.valid || 'all').trim();   // all|valid_now|expired|upcoming

    const where = [];
    const whereParams = {};

    // validity filter
    const now = new Date();
    if (valid === 'valid_now') {
      where.push('c.valid_from <= :now AND c.valid_to >= :now');
      whereParams.now = now;
    } else if (valid === 'expired') {
      where.push('c.valid_to < :now');
      whereParams.now = now;
    } else if (valid === 'upcoming') {
      where.push('c.valid_from > :now');
      whereParams.now = now;
    }

    // status filter
    if (status === 'active' || status === 'inactive') {
      where.push('c.status = :status');
      whereParams.status = status;
    }

    // search filter
    if (q) {
      const qAsId = Number(q);
      const hasId = Number.isInteger(qAsId) && qAsId > 0;

      where.push(`
        (
          c.code LIKE :q
          OR c.assigned_member LIKE :q
          OR u1.name LIKE :q
          OR u1.email LIKE :q
          OR u2.name LIKE :q
          OR u2.email LIKE :q
          ${hasId ? ' OR c.assigned_user_id = :q_id OR c.assigned_member = :q_id_str ' : ''}
        )
      `);

      whereParams.q = `%${q}%`;
      if (hasId) {
        whereParams.q_id = qAsId;
        whereParams.q_id_str = String(qAsId); // assigned_member is varchar usually
      }
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    try {
      // Dropdown users (for searchable dropdown)
      const [users] = await req.db.query(`
        SELECT id, name, email
        FROM users
        ORDER BY created_at DESC
        LIMIT 5000
      `);

      /**
       * IMPORTANT JOIN LOGIC:
       * - u1 joins using assigned_user_id (new column)
       * - u2 joins using assigned_member when it is numeric text (legacy)
       *
       * We use REGEXP to ensure assigned_member is numeric before casting.
       */
      const joinSql = `
        LEFT JOIN users u1 ON u1.id = c.assigned_user_id
        LEFT JOIN users u2
          ON u2.id = CAST(c.assigned_member AS UNSIGNED)
         AND c.assigned_member REGEXP '^[0-9]+$'
      `;

      // total count
      const [[{ total }]] = await req.db.query(
        `
        SELECT COUNT(*) AS total
        FROM master_codes c
        ${joinSql}
        ${whereSql}
        `,
        whereParams
      );

      // rows
      const [rows] = await req.db.query(
        `
        SELECT
          c.*,

          /* resolve member user info */
          COALESCE(u1.id, u2.id)     AS member_user_id,
          COALESCE(u1.name, u2.name) AS member_user_name,
          COALESCE(u1.email, u2.email) AS member_user_email,

          (SELECT COUNT(*) FROM master_code_redemptions r WHERE r.master_code_id = c.id) AS redeemed_count
        FROM master_codes c
        ${joinSql}
        ${whereSql}
        ORDER BY c.created_at DESC
        LIMIT :limit OFFSET :offset
        `,
        { ...whereParams, limit, offset }
      );

      return res.render('masters', {
        title: 'Master Creation',
        codes: rows,
        users,
        pagination: { page, limit, total },
        filters: { q, status, valid }
      });
    } catch (e) {
      console.error(e);

      // fallback users fetch (avoid EJS crash)
      let users = [];
      try {
        const [u] = await req.db.query(`
          SELECT id, name, email
          FROM users
          ORDER BY created_at DESC
          LIMIT 2000
        `);
        users = u;
      } catch {}

      return res.render('masters', {
        title: 'Master Creation',
        codes: [],
        users,
        pagination: { page: 1, limit: 20, total: 0 },
        filters: { q: '', status: 'all', valid: 'all' }
      });
    }
  }
);

router.post(
  '/masters',
  requireAuth,
  requireRole(['super', 'manager']),
  body('assigned_member').notEmpty().withMessage('Master member required'),
  body('valid_from').notEmpty().withMessage('Valid from date required'),
  body('valid_to').notEmpty().withMessage('Valid to date required'),
  body('notes').optional(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash('error', errors.array().map(e => e.msg));
      return res.redirect('/admin/masters');
    }

    const assigned_member = String(req.body.assigned_member || '').trim();
    const valid_from = String(req.body.valid_from || '').trim(); // yyyy-mm-dd
    const valid_to = String(req.body.valid_to || '').trim();     // yyyy-mm-dd
    const notes = String(req.body.notes || '').trim();

    const vf = `${valid_from} 00:00:00`;
    const vt = `${valid_to} 23:59:59`;

    if (new Date(vt) < new Date(vf)) {
      req.flash('error', 'Valid To must be after Valid From');
      return res.redirect('/admin/masters');
    }

    const adminId = req.session?.admin?.id || null;

    try {
      let code = generateMasterCode();

      // Retry on duplicate code
      for (let i = 0; i < 8; i++) {
        try {
          await req.db.query(
            `
            INSERT INTO master_codes (code, assigned_member, valid_from, valid_to, notes, created_by_admin_id)
            VALUES (:code, :assigned_member, :valid_from, :valid_to, :notes, :admin_id)
            `,
            {
              code,
              assigned_member,
              valid_from: vf,
              valid_to: vt,
              notes: notes || null,
              admin_id: adminId
            }
          );

          req.flash('success', `Master code created: ${code}`);
          return res.redirect('/admin/masters');
        } catch (e) {
          // Duplicate code => retry
          if (String(e.code || '') === 'ER_DUP_ENTRY') {
            code = generateMasterCode();
            continue;
          }
          throw e;
        }
      }

      req.flash('error', 'Failed to generate unique master code. Try again.');
      return res.redirect('/admin/masters');
    } catch (e) {
      console.error(e);
      req.flash('error', 'Failed to create master code');
      return res.redirect('/admin/masters');
    }
  }
);

router.post(
  '/masters/:id/toggle',
  requireAuth,
  requireRole(['super', 'manager']),
  param('id').isInt(),
  async (req, res) => {
    const id = Number(req.params.id);

    try {
      const [rows] = await req.db.query('SELECT status FROM master_codes WHERE id=:id', { id });
      if (!rows.length) {
        req.flash('error', 'Code not found');
        return res.redirect('/admin/masters');
      }

      const next = rows[0].status === 'active' ? 'inactive' : 'active';

      await req.db.query(
        'UPDATE master_codes SET status=:status WHERE id=:id',
        { id, status: next }
      );

      req.flash('success', `Code is now ${next}`);
      return res.redirect('/admin/masters');
    } catch (e) {
      console.error(e);
      req.flash('error', 'Failed to update code status');
      return res.redirect('/admin/masters');
    }
  }
);

router.post(
  '/masters/:id/delete',
  requireAuth,
  requireRole(['super']),
  param('id').isInt(),
  async (req, res) => {
    const id = Number(req.params.id);

    try {
      await req.db.query('DELETE FROM master_codes WHERE id=:id', { id });
      req.flash('success', 'Master code deleted');
      return res.redirect('/admin/masters');
    } catch (e) {
      console.error(e);
      req.flash('error', 'Failed to delete master code');
      return res.redirect('/admin/masters');
    }
  }
);


module.exports = router

const express = require('express')
const bcrypt = require('bcryptjs')
const { body, validationResult } = require('express-validator')
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const { requireAuth, requireRole } = require('../middleware/adminAuth')
const { blockViewerWrites } = require('../middleware/adminWriteGuard')
const { adminLoginRateLimit } = require('../middleware/adminLoginRateLimit')
const { csrfLocals, verifyCsrfPost, shouldDeferCsrfToMultipartParser } = require('../middleware/csrf')
const { blogAdminLocals } = require('../middleware/blogAdminGuards')

const router = express.Router()

// Helper to escape CSV values
const csvEscape = (v) => {
  if (v === null || v === undefined) return '""';
  return `"${String(v).replace(/"/g, '""')}"`;
};

router.use((req, res, next) => {
  const p = req.path.replace(/\/$/, '') || '/dashboard';
  res.locals.adminPath = p === '/login' ? '' : p;
  res.locals.isViewer = req.session?.admin?.role === 'viewer';
  res.locals.canWrite = req.session?.admin && ['super', 'manager'].includes(req.session.admin.role);
  next();
});

router.use(blogAdminLocals);

router.use(csrfLocals);

router.use((req, res, next) => {
  if (req.method !== 'POST') return next();
  const p = (req.path || '').replace(/\/$/, '') || '/';
  if (p === '/login') return next();
  if (shouldDeferCsrfToMultipartParser(req)) return next();
  return verifyCsrfPost(req, res, next);
});

router.use(blockViewerWrites);

router.use((req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  next();
});

router.use(require('./admin/dashboard'));

router.get('/login', (req, res) => {
  if (req.session && req.session.admin) return res.redirect('/admin/dashboard')
  res.render('login', { title: 'Admin Login',layout: false  })
})

const AUTH_FAIL_MSG = 'Unable to sign in. Check your credentials and try again.'

router.post(
  '/login',
  adminLoginRateLimit,
  body('email').isEmail().withMessage('Enter a valid work email.'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters.'),
  async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      req.flash('error', errors.array().map((e) => e.msg))
      return res.redirect('/admin/login')
    }
    const email = String(req.body.email || '').trim().toLowerCase()
    const password = req.body.password
    try {
      const [rows] = await req.db.query('SELECT * FROM admins WHERE email = :email LIMIT 1', { email })
      const admin = rows[0]
      const credsOk =
        admin &&
        admin.is_active !== 0 &&
        (await bcrypt.compare(password, admin.password_hash))
      if (!credsOk) {
        if (typeof res.locals.recordLoginFailure === 'function') res.locals.recordLoginFailure()
        req.flash('error', AUTH_FAIL_MSG)
        return res.redirect('/admin/login')
      }
      req.session.regenerate((regenErr) => {
        if (regenErr) {
          console.error('session regenerate', regenErr)
          req.flash('error', 'Sign-in could not be completed. Please try again.')
          return res.redirect('/admin/login')
        }
        req.session.admin = {
          id: admin.id,
          email: admin.email,
          name: admin.name,
          role: admin.role,
        }
        req.session.save((saveErr) => {
          if (saveErr) {
            console.error('session save', saveErr)
            req.flash('error', 'Sign-in could not be completed. Please try again.')
            return res.redirect('/admin/login')
          }
          res.redirect('/admin/dashboard')
        })
      })
    } catch (err) {
      console.error(err)
      req.flash('error', 'Sign-in is temporarily unavailable. Please try again shortly.')
      res.redirect('/admin/login')
    }
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





// ---------- Users (paginated + CRUD) ----------
function buildUsersQueryString(filters, extra = {}) {
  const p = new URLSearchParams();
  const f = filters || {};
  ['q', 'from', 'to', 'sort', 'dir', 'limit'].forEach((k) => {
    const v = f[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') p.set(k, String(v).trim());
  });
  Object.keys(extra || {}).forEach((k) => {
    if (extra[k] !== undefined && extra[k] !== null) p.set(k, extra[k]);
  });
  const s = p.toString();
  return s ? `?${s}` : '';
}

function countUsersActiveFilters(filters) {
  let n = 0;
  if (String(filters.q || '').trim()) n++;
  if (filters.from) n++;
  if (filters.to) n++;
  if (filters.sort && filters.sort !== 'created_at') n++;
  if (filters.dir && filters.dir !== 'desc') n++;
  if (filters.limit && Number(filters.limit) !== 20) n++;
  return n;
}

function usersListHasUserFilters(filters) {
  return countUsersActiveFilters(filters) > 0;
}

function usersRedirectAfterWrite(req) {
  const ret = String(req.body._list_return || '').trim();
  if (ret) return `/admin/users?${ret}`;
  const q = buildUsersQueryString({
    q: req.query.q,
    from: req.query.from,
    to: req.query.to,
    sort: req.query.sort,
    dir: req.query.dir,
    limit: req.query.limit,
    page: req.query.page,
  });
  return `/admin/users${q}`;
}

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

    const pages = Math.max(1, Math.ceil(Number(total) / limit));
    const listReturnQs = buildUsersQueryString(filters).replace(/^\?/, '');

    res.render('users', {
      title: 'Users',
      users: rows,
      filters,
      pagination: { page, limit, total, totalPages: pages },
      activeFilterCount: countUsersActiveFilters(filters),
      datasetEmpty: Number(total) === 0 && !usersListHasUserFilters(filters),
      listReturnQs,
      qsBase: (extra) => buildUsersQueryString(filters, extra),
    });
  } catch (err) {
    console.error(err);
    res.render('users', {
      title: 'Users',
      users: [],
      filters,
      pagination: { page: 1, limit, total: 0, totalPages: 1 },
      activeFilterCount: countUsersActiveFilters(filters),
      datasetEmpty: false,
      listReturnQs: '',
      qsBase: (extra) => buildUsersQueryString(filters, extra),
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
      return res.redirect(usersRedirectAfterWrite(req));
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
    const redirect = usersRedirectAfterWrite(req);
    res.redirect(redirect);
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
    const backDetail = req.body._redirect === 'detail';
    try {
      if (password && password.trim().length > 0) {
        if (password.length < 6) {
          req.flash('error', 'New password must be at least 6 chars');
          return res.redirect(backDetail ? `/admin/users/${id}` : usersRedirectAfterWrite(req));
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
  if (backDetail) {
    const ret = String(req.body._list_return || '').trim();
    const qs = ret ? `?return=${encodeURIComponent(ret)}` : '';
    return res.redirect(`/admin/users/${id}${qs}`);
  }
    res.redirect(usersRedirectAfterWrite(req));
  }
);


router.post('/users/:id/delete', requireAuth, requireRole(['super']), async (req, res) => {
  const { id } = req.params
  try { await req.db.query('DELETE FROM users WHERE id=:id', { id }); req.flash('success', 'User deleted') }
  catch (e) { req.flash('error', 'Could not delete user') }
  res.redirect(usersRedirectAfterWrite(req))
})

// ---------- Subscriptions (paginated + CSV + CRUD) ----------
// ---------- Transactions (paginated + filters + CSV) ----------
const txDisplay = require('../utils/adminTxDisplay');

function countTxActiveFilters(filters) {
  const keys = ['q', 'status', 'method', 'from', 'to', 'min_amount', 'max_amount', 'has_receipt', 'has_payment_id', 'currency', 'sort', 'dir', 'limit'];
  return keys.reduce((acc, k) => (String(filters[k] || '').trim() ? acc + 1 : acc), 0);
}

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
  const has_receipt = String(req.query.has_receipt || '').trim();
  const has_payment_id = String(req.query.has_payment_id || '').trim();

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
  if (status && ['created', 'authorized', 'in_transit', 'captured', 'failed', 'refunded'].includes(status)) {
    where.push('t.status = :status');
    params.status = status;
  }

  if (has_payment_id === '1') {
    where.push('(t.payment_id IS NOT NULL AND TRIM(t.payment_id) <> "")');
  } else if (has_payment_id === '0') {
    where.push('(t.payment_id IS NULL OR TRIM(t.payment_id) = "")');
  }

  if (has_receipt === '1') {
    where.push('(t.receipt IS NOT NULL AND TRIM(t.receipt) <> "")');
  } else if (has_receipt === '0') {
    where.push('(t.receipt IS NULL OR TRIM(t.receipt) = "")');
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
    has_receipt,
    has_payment_id,
    sort,
    dir,
    limit,
  };

  try {
    // TOTAL (same WHERE, same alias)
    const [[{ total }]] = await req.db.query(
      `SELECT COUNT(*) AS total FROM transactions t ${whereSql}`,
      params
    );

    const userJoin = `LEFT JOIN users u ON t.email IS NOT NULL AND TRIM(t.email) <> '' AND u.email = t.email`;

    // ROWS (same WHERE)
    const [rows] = await req.db.query(
      `
      SELECT t.id, t.order_id, t.payment_id, t.receipt, t.email,
             t.amount, t.currency, t.status, t.method, t.created_at,
             u.name AS user_name
      FROM transactions t
      ${userJoin}
      ${whereSql}
      ORDER BY ${sortSql} ${dirSql}
      LIMIT :limit OFFSET :offset
      `,
      params
    );

    res.render('transactions', {
      title: 'Transactions',
      txns: rows,
      filters,
      pagination: { page, limit, total },
      txDisplay,
      activeFilterCount: countTxActiveFilters(filters),
      datasetEmpty: Number(total) === 0 && !where.length,
    });
  } catch (err) {
    console.error(err);
    res.render('transactions', {
      title: 'Transactions',
      txns: [],
      filters,
      pagination: { page, limit, total: 0 },
      txDisplay,
      activeFilterCount: countTxActiveFilters(filters),
      datasetEmpty: false,
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
  const has_receipt = String(req.query.has_receipt || '').trim();
  const has_payment_id = String(req.query.has_payment_id || '').trim();

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
  if (status && ['created', 'authorized', 'in_transit', 'captured', 'failed', 'refunded'].includes(status)) {
    where.push('t.status = :status');
    params.status = status;
  }
  if (has_payment_id === '1') {
    where.push('(t.payment_id IS NOT NULL AND TRIM(t.payment_id) <> "")');
  } else if (has_payment_id === '0') {
    where.push('(t.payment_id IS NULL OR TRIM(t.payment_id) = "")');
  }
  if (has_receipt === '1') {
    where.push('(t.receipt IS NOT NULL AND TRIM(t.receipt) <> "")');
  } else if (has_receipt === '0') {
    where.push('(t.receipt IS NULL OR TRIM(t.receipt) = "")');
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
  const allowedMimeTypes = [
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'image/gif',
    'image/mp4'
  ];

  const allowedExt = /\.(png|jpe?g|webp|gif|mp4)$/i;

  const isMimeOk = allowedMimeTypes.includes(file.mimetype);
  const isExtOk = allowedExt.test(file.originalname);

  if (!isMimeOk || !isExtOk) {
    return cb(new Error('Only PNG, JPG, WEBP, GIF or Mp4 images are allowed'), false);
  }

  cb(null, true);
};

const uploadCat = multer({
  storage: catStorage,
  fileFilter: imageFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10 MB
  }
});



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



function countCategoryActiveFilters(filters) {
  let n = 0;
  if (String(filters.q || '').trim()) n++;
  if (filters.has_thumb && filters.has_thumb !== 'all') n++;
  if (filters.limit && Number(filters.limit) !== 20) n++;
  return n;
}

function categoryActionRedirect(req, id) {
  const ret = String(req.body.return || '').trim();
  if (ret === 'detail') return `/admin/categories/${id}`;
  if (ret && ret !== 'list') return `/admin/categories?${ret}`;
  return '/admin/categories';
}

router.get('/categories', requireAuth, async (req, res) => {
  const page = Math.max(parseInt(req.query.page || '1', 10), 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 5), 100);
  const offset = (page - 1) * limit;

  const q = String(req.query.q || '').trim();
  const has_thumb = String(req.query.has_thumb || 'all').trim();
  const where = [];
  const whereParams = {};

  if (q) {
    where.push('(c.name LIKE :q OR c.slug LIKE :q OR c.description LIKE :q)');
    whereParams.q = `%${q}%`;
  }
  if (has_thumb === 'yes') {
    where.push('(c.thumbnail_path IS NOT NULL AND TRIM(c.thumbnail_path) <> \'\')');
  } else if (has_thumb === 'no') {
    where.push('(c.thumbnail_path IS NULL OR TRIM(c.thumbnail_path) = \'\')');
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  try {
    const [[{ total }]] = await req.db.query(
      `SELECT COUNT(*) AS total FROM categories c ${whereSql}`,
      whereParams
    );

    const [rows] = await req.db.query(
      `
      SELECT
        c.id, c.name, c.slug, c.description, c.created_at, c.thumbnail_path, c.sort_order,
        (SELECT COUNT(*) FROM tracks t WHERE t.category_id = c.id) AS track_count
      FROM categories c
      ${whereSql}
      ORDER BY c.sort_order ASC, c.created_at DESC
      LIMIT :limit OFFSET :offset
      `,
      { ...whereParams, limit, offset }
    );

    let orderRows = [];
    if (req.session?.admin && ['super', 'manager'].includes(req.session.admin.role)) {
      const [orderList] = await req.db.query(
        `SELECT id, name, sort_order FROM categories ORDER BY sort_order ASC, id ASC`
      );
      orderRows = orderList;
    }

    const filters = { q, has_thumb, limit: String(limit) };
    res.render('categories', {
      title: 'Categories',
      categories: rows,
      orderRows,
      pagination: { page, limit, total },
      filters,
      activeFilterCount: countCategoryActiveFilters(filters),
      datasetEmpty: Number(total) === 0 && !where.length,
    });
  } catch (e) {
    console.error(e);
    const filters = { q: '', has_thumb: 'all', limit: '20' };
    res.render('categories', {
      title: 'Categories',
      categories: [],
      orderRows: [],
      pagination: { page: 1, limit: 20, total: 0 },
      filters,
      activeFilterCount: countCategoryActiveFilters(filters),
      datasetEmpty: false,
    });
  }
});

router.get(
  '/categories/:id',
  requireAuth,
  param('id').isInt(),
  async (req, res) => {
    const id = Number(req.params.id);
    try {
      const [rows] = await req.db.query(
        `
        SELECT
          c.*,
          (SELECT COUNT(*) FROM tracks t WHERE t.category_id = c.id) AS track_count
        FROM categories c
        WHERE c.id = :id
        LIMIT 1
        `,
        { id }
      );
      if (!rows[0]) {
        req.flash('error', 'Category not found');
        return res.redirect('/admin/categories');
      }

      const [tracks] = await req.db.query(
        `
        SELECT id, title, status, sort_order
        FROM tracks
        WHERE category_id = :id
        ORDER BY sort_order ASC, id ASC
        LIMIT 25
        `,
        { id }
      );

      const returnQs = String(req.query.return || '').trim();
      return res.render('category-detail', {
        title: rows[0].name,
        category: rows[0],
        tracks,
        returnQs,
      });
    } catch (e) {
      console.error(e);
      req.flash('error', 'Failed to load category');
      return res.redirect('/admin/categories');
    }
  }
);

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
      return res.redirect(categoryActionRedirect(req, id));
    }

    res.redirect(categoryActionRedirect(req, id));
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
      const ret = String(req.body.return || '').trim();
      if (ret && ret !== 'detail' && ret !== 'list') return res.redirect(`/admin/categories?${ret}`);
      return res.redirect('/admin/categories');
    } catch (e) {
      console.error(e);
      req.flash('error', 'Cannot delete: category has linked tracks');
      return res.redirect(categoryActionRedirect(req, id));
    }
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
    const ext = (
      path.extname(file.originalname) ||
      (file.fieldname === 'mp3' ? '.mp3' : '.png')
    ).toLowerCase();

    const prefix = file.fieldname === 'mp3'
      ? 'track_'
      : 'track_thumb_';

    cb(null, prefix + Date.now() + ext);
  }
});

const trackFilter = (req, file, cb) => {
  // MP3 validation
  const isMp3 =
    file.fieldname === 'mp3' &&
    (
      file.mimetype === 'audio/mpeg' ||
      /\.mp3$/i.test(file.originalname)
    );

  // Thumbnail image validation (PNG / JPG / WEBP / GIF)
  const isImg =
    file.fieldname === 'thumb' &&
    (
      ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif' , 'image/mp4']
        .includes(file.mimetype) ||
      /\.(png|jpe?g|webp|gif|mp4)$/i.test(file.originalname)
    );

  if (!isMp3 && !isImg) {
    return cb(new Error('Invalid file type. Only MP3 and PNG/JPG/WEBP/GIF/Mp4 images are allowed'), false);
  }

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


function countTrackActiveFilters(filters) {
  let n = 0;
  if (String(filters.q || '').trim()) n++;
  if (filters.category_id && Number(filters.category_id) > 0) n++;
  if (filters.type && filters.type !== 'all') n++;
  if (filters.status && filters.status !== 'all') n++;
  if (String(filters.date_from || '').trim()) n++;
  if (String(filters.date_to || '').trim()) n++;
  if (filters.limit && Number(filters.limit) !== 20) n++;
  return n;
}

function trackActionRedirect(req, id) {
  const ret = String(req.body.return || '').trim();
  if (ret === 'detail') return `/admin/tracks/${id}`;
  if (ret && ret !== 'list') return `/admin/tracks?${ret}`;
  return '/admin/tracks';
}

router.get('/tracks', requireAuth, async (req, res) => {
  const page = Math.max(parseInt(req.query.page || '1', 10), 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 5), 100);
  const offset = (page - 1) * limit;

  const selectedCategoryId = Number(req.query.category_id || 0);
  const q = String(req.query.q || '').trim();
  const type = String(req.query.type || 'all').trim();
  const status = String(req.query.status || 'all').trim();
  const date_from = String(req.query.date_from || '').trim();
  const date_to = String(req.query.date_to || '').trim();

  const where = [];
  const params = { limit, offset };

  if (selectedCategoryId > 0) {
    where.push('t.category_id = :category_id');
    params.category_id = selectedCategoryId;
  }

  if (q) {
    where.push('t.title LIKE :q');
    params.q = `%${q}%`;
  }

  if (type === 'free') {
    where.push('t.price_paise = 0');
  } else if (type === 'premium') {
    where.push('t.price_paise > 0');
  }

  if (status === 'active' || status === 'inactive') {
    where.push('t.status = :status');
    params.status = status;
  }

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

    const [[{ total }]] = await req.db.query(
      `SELECT COUNT(*) AS total FROM tracks t ${whereSql}`,
      params
    );

    const [rows] = await req.db.query(
      `
      SELECT t.id, t.title, t.description, t.mp3_path, t.thumbnail_path,
             t.price_paise, t.status, t.category_id, c.name AS category_name,
             t.created_at, t.sort_order
      FROM tracks t
      JOIN categories c ON c.id = t.category_id
      ${whereSql}
      ORDER BY t.category_id ASC, t.sort_order ASC, t.created_at DESC
      LIMIT :limit OFFSET :offset
      `,
      params
    );

    let orderRows = [];
    if (selectedCategoryId > 0 && req.session?.admin && ['super', 'manager'].includes(req.session.admin.role)) {
      const [orderList] = await req.db.query(
        `
        SELECT id, title, sort_order
        FROM tracks
        WHERE category_id = :category_id
        ORDER BY sort_order ASC, id ASC
        `,
        { category_id: selectedCategoryId }
      );
      orderRows = orderList;
    }

    const filters = {
      q,
      category_id: selectedCategoryId ? String(selectedCategoryId) : '0',
      type,
      status,
      date_from,
      date_to,
      limit: String(limit),
    };

    res.render('tracks', {
      title: 'Tracks',
      tracks: rows,
      categories: cats,
      orderRows,
      pagination: { page, limit, total },
      filters,
      activeFilterCount: countTrackActiveFilters(filters),
      datasetEmpty: Number(total) === 0 && !where.length,
    });
  } catch (e) {
    console.error(e);
    const filters = {
      q: '',
      category_id: '0',
      type: 'all',
      status: 'all',
      date_from: '',
      date_to: '',
      limit: '20',
    };
    res.render('tracks', {
      title: 'Tracks',
      tracks: [],
      categories: [],
      orderRows: [],
      pagination: { page: 1, limit: 20, total: 0 },
      filters,
      activeFilterCount: countTrackActiveFilters(filters),
      datasetEmpty: false,
    });
  }
});

router.get(
  '/tracks/:id',
  requireAuth,
  param('id').isInt(),
  async (req, res) => {
    const id = Number(req.params.id);
    try {
      const [rows] = await req.db.query(
        `
        SELECT t.*, c.name AS category_name
        FROM tracks t
        JOIN categories c ON c.id = t.category_id
        WHERE t.id = :id
        LIMIT 1
        `,
        { id }
      );
      if (!rows[0]) {
        req.flash('error', 'Track not found');
        return res.redirect('/admin/tracks');
      }

      const [cats] = await req.db.query(
        'SELECT id, name FROM categories ORDER BY sort_order ASC, name ASC'
      );

      const returnQs = String(req.query.return || '').trim();
      return res.render('track-detail', {
        title: rows[0].title,
        track: rows[0],
        categories: cats,
        returnQs,
      });
    } catch (e) {
      console.error(e);
      req.flash('error', 'Failed to load track');
      return res.redirect('/admin/tracks');
    }
  }
);


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
      return res.redirect(trackActionRedirect(req, id));
    }
    res.redirect(trackActionRedirect(req, id));
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
      const ret = String(req.body.return || '').trim();
      if (ret && ret !== 'detail' && ret !== 'list') return res.redirect(`/admin/tracks?${ret}`);
      return res.redirect('/admin/tracks');
    } catch (e) {
      console.error(e);
      req.flash('error', 'Failed to delete track');
      return res.redirect(trackActionRedirect(req, id));
    }
  }
);




// -------------------- MASTER CREATION (CODES) --------------------

const MASTER_CODES_JOIN_SQL = `
  LEFT JOIN users u1 ON u1.id = c.assigned_user_id
  LEFT JOIN users u2
    ON u2.id = CAST(c.assigned_member AS UNSIGNED)
   AND c.assigned_member REGEXP '^[0-9]+$'
`;

function countMasterActiveFilters(filters) {
  let n = 0;
  if (String(filters.q || '').trim()) n++;
  if (filters.status && filters.status !== 'all') n++;
  if (filters.valid && filters.valid !== 'all') n++;
  if (filters.limit && Number(filters.limit) !== 20) n++;
  return n;
}

function masterActionRedirect(req, id) {
  const ret = String(req.body.return || '').trim();
  if (ret === 'detail') return `/admin/masters/${id}`;
  if (ret === 'list' || !ret) return '/admin/masters';
  return `/admin/masters?${ret}`;
}
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
      const users = [];

      /**
       * IMPORTANT JOIN LOGIC:
       * - u1 joins using assigned_user_id (new column)
       * - u2 joins using assigned_member when it is numeric text (legacy)
       *
       * We use REGEXP to ensure assigned_member is numeric before casting.
       */
      const joinSql = MASTER_CODES_JOIN_SQL;

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

      const filters = { q, status, valid, limit: String(limit) };
      return res.render('masters', {
        title: 'Master codes',
        codes: rows,
        users,
        pagination: { page, limit, total },
        filters,
        activeFilterCount: countMasterActiveFilters(filters),
        datasetEmpty: Number(total) === 0 && !where.length,
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

      const filters = { q: '', status: 'all', valid: 'all', limit: '20' };
      return res.render('masters', {
        title: 'Master codes',
        codes: [],
        users,
        pagination: { page: 1, limit: 20, total: 0 },
        filters,
        activeFilterCount: countMasterActiveFilters(filters),
        datasetEmpty: false,
      });
    }
  }
);

router.get(
  '/masters/:id',
  requireAuth,
  requireRole(['super', 'manager']),
  param('id').isInt(),
  async (req, res) => {
    const id = Number(req.params.id);
    try {
      const [rows] = await req.db.query(
        `
        SELECT
          c.*,
          COALESCE(u1.id, u2.id)     AS member_user_id,
          COALESCE(u1.name, u2.name) AS member_user_name,
          COALESCE(u1.email, u2.email) AS member_user_email,
          (SELECT COUNT(*) FROM master_code_redemptions r WHERE r.master_code_id = c.id) AS redeemed_count
        FROM master_codes c
        ${MASTER_CODES_JOIN_SQL}
        WHERE c.id = :id
        LIMIT 1
        `,
        { id }
      );
      if (!rows[0]) {
        req.flash('error', 'Master code not found');
        return res.redirect('/admin/masters');
      }
      const returnQs = String(req.query.return || '').trim();
      return res.render('master-detail', {
        title: 'Master code',
        code: rows[0],
        returnQs,
      });
    } catch (e) {
      console.error(e);
      req.flash('error', 'Failed to load master code');
      return res.redirect('/admin/masters');
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
      return res.redirect(masterActionRedirect(req, id));
    } catch (e) {
      console.error(e);
      req.flash('error', 'Failed to update code status');
      return res.redirect(masterActionRedirect(req, id));
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
      const ret = String(req.body.return || '').trim();
      if (ret && ret !== 'detail' && ret !== 'list') return res.redirect(`/admin/masters?${ret}`);
      return res.redirect('/admin/masters');
    } catch (e) {
      console.error(e);
      req.flash('error', 'Failed to delete master code');
      return res.redirect('/admin/masters');
    }
  }
);

router.use(require('./admin/search'));
router.use(require('./admin/reports'));
router.use(require('./admin/subscriptions'));
router.use(require('./admin/staff'));
router.use(require('./admin/audit'));
router.use(require('./admin/details'));

router.use('/blogs', require('./admin/blogs'));
router.use('/blog', require('./admin/blog'));

module.exports = router

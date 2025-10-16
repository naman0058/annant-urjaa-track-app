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

router.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const [[{ totalUsers }]] = await req.db.query('SELECT COUNT(*) AS totalUsers FROM users')
    const [[{ totalSubscribers }]] = await req.db.query('SELECT COUNT(DISTINCT user_id) AS totalSubscribers FROM subscriptions WHERE status = "active"')
    const [[{ totalSales }]] = await req.db.query('SELECT COALESCE(SUM(amount),0) AS totalSales FROM transactions WHERE status = "captured"')

    const [subsMonthly] = await req.db.query(`
      SELECT DATE_FORMAT(created_at, '%Y-%m') AS ym, COUNT(*) AS count
      FROM subscriptions
      WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 11 MONTH)
      GROUP BY ym
      ORDER BY ym
    `)
    const [salesMonthly] = await req.db.query(`
      SELECT DATE_FORMAT(created_at, '%Y-%m') AS ym, SUM(amount) AS amount
      FROM transactions
      WHERE status = "captured" AND created_at >= DATE_SUB(CURDATE(), INTERVAL 11 MONTH)
      GROUP BY ym
      ORDER BY ym
    `)

    res.render('dashboard', {
      title: 'Admin Dashboard',
      stats: { totalUsers, totalSubscribers, totalSales },
      subsMonthly,
      salesMonthly
    })
  } catch (err) {
    console.error(err)
    res.render('dashboard', {
      title: 'Admin Dashboard',
      stats: { totalUsers: 0, totalSubscribers: 0, totalSales: 0 },
      subsMonthly: [],
      salesMonthly: []
    })
  }
})

// ---------- Users (paginated + CRUD) ----------
router.get('/users', requireAuth, async (req, res) => {
  const page = Math.max(parseInt(req.query.page || '1'), 1)
  const limit = Math.min(Math.max(parseInt(req.query.limit || '20'), 5), 100)
  const offset = (page - 1) * limit
  try {
    const [[{ total }]] = await req.db.query('SELECT COUNT(*) AS total FROM users')
    const [rows] = await req.db.query('SELECT id, name, email, created_at FROM users ORDER BY created_at DESC LIMIT :limit OFFSET :offset', { limit, offset })
    res.render('users', { title: 'User Management', users: rows, pagination: { page, limit, total } })
  } catch (err) {
    console.error(err)
    res.render('users', { title: 'User Management', users: [], pagination: { page, limit, total: 0 } })
  }
})
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
  const page = Math.max(parseInt(req.query.page || '1'), 1)
  const limit = Math.min(Math.max(parseInt(req.query.limit || '20'), 5), 100)
  const offset = (page - 1) * limit
  try {
    const [[{ total }]] = await req.db.query('SELECT COUNT(*) AS total FROM subscriptions')
    const [rows] = await req.db.query(`
      SELECT s.id, u.name AS user_name, u.email, s.track, s.status, s.start_date, s.end_date, s.created_at, s.user_id
      FROM subscriptions s
      JOIN users u ON u.id = s.user_id
      ORDER BY s.created_at DESC
      LIMIT :limit OFFSET :offset
    `, { limit, offset })
    res.render('subscriptions', { title: 'Subscription Report', subs: rows, pagination: { page, limit, total } })
  } catch (err) {
    console.error(err)
    res.render('subscriptions', { title: 'Subscription Report', subs: [], pagination: { page, limit, total: 0 } })
  }
})
router.get('/subscriptions.csv', requireAuth, async (req, res) => {
  try {
    const [rows] = await req.db.query(`
      SELECT s.id, u.name AS user_name, u.email, s.track, s.status, s.start_date, s.end_date, s.created_at
      FROM subscriptions s
      JOIN users u ON u.id = s.user_id
      ORDER BY s.created_at DESC
      LIMIT 2000
    `);

    const header = [
      'id','user_name','email','track','status','start_date','end_date','created_at'
    ].map(csvEscape).join(',') + '\n';

    const lines = rows.map(r => [
      r.id, r.user_name, r.email, r.track, r.status,
      r.start_date || '', r.end_date || '', r.created_at
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
      await req.db.query('INSERT INTO subscriptions (user_id, track, status, start_date, end_date) VALUES (:user_id, :track, :status, :start_date, :end_date)', {
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
      await req.db.query('UPDATE subscriptions SET track=:track, status=:status, start_date=:start_date, end_date=:end_date WHERE id=:id', {
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
  const { q, status, from, to, method } = req.query
  const page = Math.max(parseInt(req.query.page || '1'), 1)
  const limit = Math.min(Math.max(parseInt(req.query.limit || '20'), 5), 200)
  const offset = (page - 1) * limit
  let where = 'WHERE 1=1'
  const params = {}
  if (q) { where += ' AND (order_id LIKE :q OR payment_id LIKE :q OR receipt LIKE :q OR email LIKE :q)'; params.q = `%${q}%` }
  if (status) { where += ' AND status = :status'; params.status = status }
  if (method) { where += ' AND method = :method'; params.method = method }
  if (from) { where += ' AND DATE(created_at) >= :from'; params.from = from }
  if (to) { where += ' AND DATE(created_at) <= :to'; params.to = to }

  try {
    const [[{ total }]] = await req.db.query(`SELECT COUNT(*) AS total FROM transactions ${where}`, params)
    const [rows] = await req.db.query(`
      SELECT id, order_id, payment_id, receipt, email, amount, currency, status, method, created_at
      FROM transactions
      ${where}
      ORDER BY created_at DESC
      LIMIT :limit OFFSET :offset
    `, { ...params, limit, offset })
    res.render('transactions', { title: 'Transaction Report', txns: rows, filters: { q, status, from, to, method }, pagination: { page, limit, total } })
  } catch (err) {
    console.error(err)
    res.render('transactions', { title: 'Transaction Report', txns: [], filters: { q, status, from, to, method }, pagination: { page, limit, total: 0 } })
  }
})

router.get('/transactions.csv', requireAuth, async (req, res) => {
  const { q, status, from, to, method } = req.query;
  let where = 'WHERE 1=1';
  const params = {};
  if (q) { where += ' AND (order_id LIKE :q OR payment_id LIKE :q OR receipt LIKE :q OR email LIKE :q)'; params.q = `%${q}%`; }
  if (status) { where += ' AND status = :status'; params.status = status; }
  if (method) { where += ' AND method = :method'; params.method = method; }
  if (from) { where += ' AND DATE(created_at) >= :from'; params.from = from; }
  if (to) { where += ' AND DATE(created_at) <= :to'; params.to = to; }

  try {
    const [rows] = await req.db.query(`
      SELECT created_at, order_id, payment_id, receipt, email, amount, currency, status, method
      FROM transactions
      ${where}
      ORDER BY created_at DESC
      LIMIT 10000
    `, params);

    const header = [
      'created_at','order_id','payment_id','receipt','email','amount','currency','status','method'
    ].map(csvEscape).join(',') + '\n';

    const lines = rows.map(r => [
      r.created_at, r.order_id, r.payment_id || '', r.receipt || '',
      r.email || '', r.amount, r.currency || 'INR', r.status, r.method || ''
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

router.get('/categories', requireAuth, async (req, res) => {
  const page = Math.max(parseInt(req.query.page || '1'), 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit || '20'), 5), 100);
  const offset = (page - 1) * limit;
  try {
    const [[{ total }]] = await req.db.query('SELECT COUNT(*) AS total FROM categories');
    const [rows] = await req.db.query(
      'SELECT id, name, slug, created_at, thumbnail_path FROM categories ORDER BY created_at DESC LIMIT :limit OFFSET :offset',
      { limit, offset }
    );
    res.render('categories', { title: 'Categories', categories: rows, pagination: { page, limit, total } });
  } catch (e) {
    console.error(e);
    res.render('categories', { title: 'Categories', categories: [], pagination: { page: 1, limit: 20, total: 0 } });
  }
});

router.post(
  '/categories',
  requireAuth,
  requireRole(['super','manager']),
  uploadCat.single('thumb'),
  body('name').notEmpty().withMessage('Name required'),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash('error', errors.array().map(e => e.msg));
      return res.redirect('/admin/categories');
    }
    const { name } = req.body;
    const slug = slugify(name);
    const thumbnail_path = req.file ? `/uploads/categories/${req.file.filename}` : null;
    try {
      await req.db.query(
        'INSERT INTO categories (name, slug, thumbnail_path) VALUES (:name, :slug, :thumbnail_path)',
        { name, slug, thumbnail_path }
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
  '/categories/:id',
  requireAuth,
  requireRole(['super','manager']),
  uploadCat.single('thumb'),
  param('id').isInt(),
  body('name').notEmpty(),
  async (req, res) => {
    const { id } = req.params;
    const { name } = req.body;
    const slug = slugify(name);

    let thumbnailClause = '';
    const params = { id, name, slug };

    if (req.file) {
      // fetch old path to delete
      const [rows] = await req.db.query('SELECT thumbnail_path FROM categories WHERE id=:id', { id });
      const old = rows[0]?.thumbnail_path;
      const newPath = `/uploads/categories/${req.file.filename}`;
      thumbnailClause = ', thumbnail_path=:thumbnail_path';
      params.thumbnail_path = newPath;

      try {
        await req.db.query(
          `UPDATE categories SET name=:name, slug=:slug${thumbnailClause} WHERE id=:id`, params
        );
        if (old) fs.unlink(path.join(__dirname, '..', 'public', old), () => {});
        req.flash('success', 'Category updated');
      } catch (e) {
        console.error(e);
        req.flash('error', 'Failed to update category');
      }
    } else {
      try {
        await req.db.query(
          `UPDATE categories SET name=:name, slug=:slug WHERE id=:id`, params
        );
        req.flash('success', 'Category updated');
      } catch (e) {
        console.error(e);
        req.flash('error', 'Failed to update category');
      }
    }
    res.redirect('/admin/categories');
  }
);

router.post(
  '/categories/:id/delete',
  requireAuth,
  requireRole(['super']),
  param('id').isInt(),
  async (req, res) => {
    const { id } = req.params;
    try {
      // Will error if tracks exist with this category due to FK (RESTRICT). Handle as needed.
      await req.db.query('DELETE FROM categories WHERE id=:id', { id });
      req.flash('success', 'Category deleted');
    } catch (e) {
      console.error(e);
      req.flash('error', 'Cannot delete: category has linked tracks');
    }
    res.redirect('/admin/categories');
  }
);




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
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});


// -------------------- TRACK CRUD --------------------
// Price is submitted in INR (e.g. 1499.00), stored as integer paise (149900)
const toPaise = (inr) => {
  const n = parseFloat(String(inr || '0').replace(/,/g, ''));
  if (isNaN(n)) return 0;
  return Math.round(n * 100);
};

router.get('/tracks', requireAuth, async (req, res) => {
  const page = Math.max(parseInt(req.query.page || '1'), 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit || '20'), 5), 100);
  const offset = (page - 1) * limit;

  try {
    const [[{ total }]] = await req.db.query('SELECT COUNT(*) AS total FROM tracks');
    const [cats] = await req.db.query('SELECT id, name FROM categories ORDER BY name ASC');
    const [rows] = await req.db.query(`
      SELECT t.id, t.title, t.description, t.mp3_path, t.thumbnail_path,
       t.price_paise, t.status, t.category_id, c.name AS category_name, t.created_at
FROM tracks t
JOIN categories c ON c.id = t.category_id
      ORDER BY t.created_at DESC
      LIMIT :limit OFFSET :offset
    `, { limit, offset });

    res.render('tracks', {
      title: 'Play Tracks',
      tracks: rows,
      categories: cats,
      pagination: { page, limit, total }
    });
  } catch (e) {
    console.error(e);
    res.render('tracks', {
      title: 'Play Tracks',
      tracks: [],
      categories: [],
      pagination: { page: 1, limit: 20, total: 0 }
    });
  }
});

router.post(
  '/tracks',
  requireAuth,
  requireRole(['super','manager']),
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
    const price_paise = toPaise(price_inr);
    const mp3_file = req.files?.mp3?.[0];
    const thumb_file = req.files?.thumb?.[0];

    const mp3_path = mp3_file ? `/uploads/tracks/${mp3_file.filename}` : null;
    const thumbnail_path = thumb_file ? `/uploads/tracks/${thumb_file.filename}` : null;

    try {
      await req.db.query(
        `INSERT INTO tracks (category_id, title, description, mp3_path, thumbnail_path, price_paise, status)
         VALUES (:category_id, :title, :description, :mp3_path, :thumbnail_path, :price_paise, :status)`,
        { category_id, title, description: description || null, mp3_path, thumbnail_path, price_paise, status: status || 'active' }
      );
      req.flash('success', 'Track created');
    } catch (e) {
      console.error(e);
      req.flash('error', 'Failed to create track');
    }
    res.redirect('/admin/tracks');
  }
);

router.post(
  '/tracks/:id',
  requireAuth,
  requireRole(['super','manager']),
  uploadTrack.fields([{ name: 'mp3', maxCount: 1 }, { name: 'thumb', maxCount: 1 }]),
  param('id').isInt(),
  body('category_id').isInt(),
  body('title').notEmpty(),
  body('price_inr').notEmpty(),
  async (req, res) => {
    const { id } = req.params;
    const { category_id, title, description, price_inr, status } = req.body;
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
            id, category_id, title, description: description || null,
            mp3_path: newMp3Path, thumbnail_path: newThumbPath,
            price_paise, status
          }
        );
        // delete replaced files
        if (newMp3Path && prev.mp3_path) fs.unlink(path.join(__dirname, '..', 'public', prev.mp3_path), () => {});
        if (newThumbPath && prev.thumbnail_path) fs.unlink(path.join(__dirname, '..', 'public', prev.thumbnail_path), () => {});
      } else {
        await req.db.query(
          `UPDATE tracks
           SET category_id=:category_id, title=:title, description=:description,
               price_paise=:price_paise, status=:status
           WHERE id=:id`,
          { id, category_id, title, description: description || null, price_paise, status }
        );
      }

      req.flash('success', 'Track updated');
    } catch (e) {
      console.error(e);
      req.flash('error', 'Failed to update track');
    }
    res.redirect('/admin/tracks');
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
      await req.db.query('DELETE FROM tracks WHERE id=:id', { id });
      req.flash('success', 'Track deleted');
    } catch (e) {
      console.error(e);
      req.flash('error', 'Failed to delete track');
    }
    res.redirect('/admin/tracks');
  }
);




module.exports = router

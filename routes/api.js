const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const router = express.Router();

// Use a separate JWT secret (fallback to SESSION_SECRET)
const JWT_SECRET = process.env.API_JWT_SECRET || process.env.SESSION_SECRET || 'api-secret';
const JWT_EXPIRES = '7d'; // tweak if you like

/** helpers **/
const signToken = (user) =>
  jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: JWT_EXPIRES });

const authOptional = async (req, res, next) => {
  const header = req.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next();
  try {
    req.user = jwt.verify(token, JWT_SECRET);
  } catch (_) { /* ignore invalid token for optional auth */ }
  next();
};

const authRequired = async (req, res, next) => {
  const header = req.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
};

const inrFromPaise = (p) => (Number(p || 0) / 100);


router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Basic validation
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required.' });
    }

    // Check if email already exists
    const [exists] = await req.db.query(
      'SELECT id FROM users WHERE email = :email LIMIT 1',
      { email }
    );
    if (exists.length > 0) {
      return res.status(409).json({ error: 'Email already registered.' });
    }

    // Hash password
    const password_hash = await bcrypt.hash(password, 10);

    // Insert user
    const [result] = await req.db.query(
      `INSERT INTO users (name, email, password_hash, created_at)
       VALUES (:name, :email, :password, NOW())`,
      { name, email, password: password_hash }
    );

    const user_id = result.insertId;

    // Fetch inserted user
    const [userRows] = await req.db.query(
      'SELECT id, name, email, created_at FROM users WHERE id = :id',
      { id: user_id }
    );

    return res.status(201).json({
      message: 'User registered successfully.',
      user: userRows[0]
    });

  } catch (error) {
    console.error('Register error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});


/** ---------- POST /api/login (user) ---------- **/
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

  try {
    const [rows] = await req.db.query('SELECT id, name, email, password_hash FROM users WHERE email = :email LIMIT 1', { email });
    if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });

    const u = rows[0];
    if (!u.password_hash) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signToken(u);
    return res.json({
      token,
      user: { id: u.id, name: u.name, email: u.email }
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Login failed' });
  }
});

/** ---------- GET /api/categories (public) ---------- **/
router.get('/categories', async (req, res) => {
  try {
    const [rows] = await req.db.query(
      'SELECT id, name, slug, thumbnail_path FROM categories ORDER BY name ASC'
    );
    res.json({ categories: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load categories' });
  }
});

/** ---------- GET /api/categories/:id/tracks (public) ---------- **/
router.get('/categories/:id/tracks', async (req, res) => {
  const { id } = req.params;
  try {
    const [catRows] = await req.db.query('SELECT id, name, slug, thumbnail_path FROM categories WHERE id = :id LIMIT 1', { id });
    if (!catRows.length) return res.status(404).json({ error: 'Category not found' });

    const [tracks] = await req.db.query(`
      SELECT t.id, t.title, t.description, t.thumbnail_path, t.price_paise, t.status,
             t.mp3_path, t.created_at
      FROM tracks t
      WHERE t.category_id = :id
      ORDER BY t.created_at DESC
    `, { id });

    const payload = tracks.map(t => ({
      id: t.id,
      title: t.title,
      description: t.description,
      thumbnail: t.thumbnail_path || null,
      is_free: Number(t.price_paise || 0) === 0,
      price_inr: inrFromPaise(t.price_paise),
      status: t.status,
      mp3_path: t.mp3_path
      // mp3 is intentionally omitted here; fetch via single track endpoint
    }));

    res.json({
      category: catRows[0],
      tracks: payload
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load tracks' });
  }
});

/** ---------- GET /api/tracks/:id (auth optional) ----------
 * Rules:
 * - If price == 0  => return FULL track with label "free" (no auth required).
 * - If price > 0:
 *    - if user has an active subscription => return FULL track
 *    - else => 402 with { need_subscription: true, amount, track_summary }
 */
router.get('/tracks/:id', authOptional, async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await req.db.query(`
      SELECT t.id, t.title, t.description, t.thumbnail_path, t.mp3_path,
             t.price_paise, t.status, t.category_id, c.name AS category_name
      FROM tracks t
      JOIN categories c ON c.id = t.category_id
      WHERE t.id = :id
      LIMIT 1
    `, { id });

    if (!rows.length) return res.status(404).json({ error: 'Track not found' });
    const t = rows[0];
    const pricePaise = Number(t.price_paise || 0);

    // Always include a compact summary
    const summary = {
      id: t.id,
      title: t.title,
      description: t.description,
      category: { id: t.category_id, name: t.category_name },
      thumbnail: t.thumbnail_path || null,
      is_free: pricePaise === 0,
      price_inr: inrFromPaise(pricePaise),
      status: t.status
    };

    // Free track => return full right away
    if (pricePaise === 0) {
      return res.json({
        label: 'free',
        track: {
          ...summary,
          mp3: t.mp3_path || null
        }
      });
    }

    // Paid track => need to check subscription if user is known
    let hasActiveSub = false;
    if (req.user && req.user.id) {
      const uid = req.user.id;
      const [sub] = await req.db.query(`
        SELECT id FROM subscriptions
        WHERE user_id = :uid
          AND status = 'active'
          AND (start_date IS NULL OR start_date <= CURDATE())
          AND (end_date   IS NULL OR end_date   >= CURDATE())
        LIMIT 1
      `, { uid });
      hasActiveSub = sub.length > 0;
    }

    if (hasActiveSub) {
      return res.json({
        track: {
          ...summary,
          mp3: t.mp3_path || null
        }
      });
    }

    // No active subscription (or unauthenticated) => ask for subscription
    // Use HTTP 402 (Payment Required) to signal the client
    return res.status(402).json({
      need_subscription: true,
      amount_inr: inrFromPaise(pricePaise),
      track: summary
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load track' });
  }
});



// GET /api/subscription/status?user_id=123&track_id=456
router.get('/subscription/status', async (req, res) => {
  const user_id = parseInt(req.query.user_id, 10);
  const track_id = parseInt(req.query.track_id, 10);
  if (!user_id || !track_id) {
    return res.status(400).json({ error: 'user_id and track_id are required' });
  }

  try {
    // 1) Get the track (for fallback + response)
    const [tRows] = await req.db.query(
      'SELECT id, title, price_paise FROM tracks WHERE id = :track_id LIMIT 1',
      { track_id }
    );
    if (!tRows.length) return res.status(404).json({ error: 'Track not found' });
    const track = tRows[0];

    // 2) Detect whether subscriptions.track_id column exists
    const [colRows] = await req.db.query(`
      SELECT 1
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'subscriptions'
        AND COLUMN_NAME = 'track_id'
      LIMIT 1
    `);

    let subRows = [];
    if (colRows.length) {
      // Modern schema: subscriptions has track_id
      [subRows] = await req.db.query(`
        SELECT id, user_id, track_id, status, start_date, end_date
        FROM subscriptions
        WHERE user_id = :user_id
          AND track_id = :track_id
        ORDER BY created_at DESC
        LIMIT 1
      `, { user_id, track_id });
    } else {
      // Legacy schema: subscriptions.track holds the track title/name
      [subRows] = await req.db.query(`
        SELECT id, user_id, track AS track_title, status, start_date, end_date
        FROM subscriptions
        WHERE user_id = :user_id
          AND track = :track_title
        ORDER BY created_at DESC
        LIMIT 1
      `, { user_id, track_title: track.title });
    }

    if (!subRows.length) {
      return res.json({
        status: 'not_subscribed',
        user_id,
        track_id,
        track_title: track.title
      });
    }

    const sub = subRows[0];

    // ----- Correct date logic (as of today) -----
    // active if:
    //   - status = 'active'
    //   - (start_date is null or start_date <= today)
    //   - (end_date is null or end_date >= today)
    // expired if:
    //   - end_date < today
    // otherwise:
    //   - cancelled or not_yet_started, etc.

    // Using DB to compute "today"
    const [[{ today }]] = await req.db.query(`SELECT CURDATE() AS today`);
    const todayStr = String(today); // 'YYYY-MM-DD'

    const end = sub.end_date ? String(sub.end_date) : null;
    const start = sub.start_date ? String(sub.start_date) : null;

    const isAfterOrEq = (a, b) => a >= b; // strings in 'YYYY-MM-DD' compare lexicographically
    const isBefore = (a, b) => a < b;

    let derivedStatus = 'expired';

    if (sub.status === 'cancelled') {
      derivedStatus = 'cancelled';
    } else if (!end || isAfterOrEq(end, todayStr)) {
      // End is null (no expiry) or in the future/today
      if (!start || !isBefore(start, todayStr) || start <= todayStr) {
        // start is null or <= today => active
        derivedStatus = 'active';
      } else {
        derivedStatus = 'not_yet_started';
      }
    } else if (end && isBefore(end, todayStr)) {
      derivedStatus = 'expired';
    }

    return res.json({
      status: derivedStatus,               // 'active' | 'expired' | 'cancelled' | 'not_yet_started'
      user_id,
      track_id,
      track_title: track.title,
      subscription: {
        id: sub.id,
        status_db: sub.status,            // original DB status field
        start_date: start,
        end_date: end
      }
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Failed to check subscription' });
  }
});


const Razorpay = require("razorpay");
var instance  = new Razorpay({
    key_id: 'rzp_test_htmhBsjoS9btm0',
    key_secret: 'uYtSO5ly2TfqM8Cxx0lCgY9t',
  });


    function generatereceipt() {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let receipt = 'order_rcptid_';
    for (let i = 0; i < 12; i++) {
      receipt += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return receipt;
}




router.get('/payments/generate-order', async (req, res) => {
  try {
    const { user_id, amount, track_id } = req.query || {};

    // Basic validation
    const uid = Number.parseInt(user_id, 10);
    const amt = Number(amount);
    if (!Number.isInteger(uid) || uid <= 0) {
      return res.status(400).json({ error: 'Valid user_id is required' });
    }
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ error: 'A positive amount is required' });
    }

    // Get user email for transactions row
    const [uRows] = await req.db.query(
      'SELECT id, email FROM users WHERE id = :id LIMIT 1',
      { id: uid }
    );
    if (!uRows || !uRows.length) {
      return res.status(404).json({ error: 'User not found' });
    }
    const userEmail = uRows[0].email;

    // Optional: idempotency by track_id — if you use unique(track_id) in DB, you can early return
    // const [existing] = await req.db.query(
    //   'SELECT order_id FROM transactions WHERE track_id = :track_id AND status IN ("in_transit","created") LIMIT 1',
    //   { track_id }
    // );
    // if (existing?.length) {
    //   return res.status(200).json({ order_id: existing[0].order_id, reused: true });
    // }

    // Create Razorpay order
    const receipt = generatereceipt(track_id, uid);
    const orderOptions = {
      amount: Math.round(amt * 100), // in paise
      currency: 'INR',
      receipt
      // notes: { user_id: String(uid), track_id: String(track_id ?? '') }, // optional
    };

    // Prefer async/await over callback style
    const order = await instance.orders.create(orderOptions);
    // order has: id, amount, currency, receipt, status, created_at, etc.

    // Persist transaction as 'in_transit' (payment_id/method unknown yet)
    await req.db.query(
      `INSERT INTO transactions 
        (order_id, payment_id, receipt, email, amount, currency, status, method, created_at, track_id, user_id)
       VALUES
        (:order_id, NULL, :receipt, :email, :amount, :currency, 'in_transit', NULL, NOW(), :track_id, :user_id)`,
      {
        order_id: order.id,
        receipt: order.receipt || receipt,
        email: userEmail,
        // Decide whether you store INR or paise. Here we store INR for readability.
        amount: amt,
        currency: order.currency || 'INR',
        track_id: track_id ?? null,
        user_id: uid
      }
    );

    // Respond with the order object (client will use order.id for checkout)
    return res.status(201).json(order);
  } catch (err) {
    // Razorpay errors often include .error with description/code
    console.error('Order creation failed:', err);
    const message =
      err?.error?.description ||
      err?.message ||
      'Failed to create order';
    return res.status(500).json({ error: message });
  }
});




function formatDate(date) {
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0'); // January is 0!
    const yyyy = date.getFullYear();
    return yyyy + '-' + mm + '-' + dd ;
  }


  function getCurrentDate() {
    const today = new Date();
    return formatDate(today);
  }


router.get('/pay/razorpay', (req, res) => {
  console.log('order',req.query.order)
  res.render('pay', { order:req.query.order,title: 'Admin Login',layout: false }); // express-ejs-layouts will wrap it; ok
});

const crypto = require('crypto');

const RAZORPAY_KEY_SECRET  = 'uYtSO5ly2TfqM8Cxx0lCgY9t'

router.get('/payment/razorpay-success', async (req, res) => {
  const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.query;

  console.log('query', req.query);

  if (!(razorpay_payment_id && razorpay_order_id && razorpay_signature)) {
    return res.status(400).json({ msg: 'Error Occurred' });
  }

  // ✅ Step 1: Verify Razorpay signature (order_id|payment_id)
  try {
    if (!RAZORPAY_KEY_SECRET) {
      console.error('RAZORPAY_KEY_SECRET not configured');
      return res.status(500).json({ msg: 'Internal error' });
    }

    const signedPayload = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSignature = crypto
      .createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(signedPayload)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.json({ msg: 'Unauthorized Payment' });
    }
  } catch (e) {
    console.error('Signature verify error:', e);
    return res.status(500).json({ msg: 'Internal error' });
  }

  const now = getCurrentDate();

  try {
    // ✅ Step 2: Fetch user_id and track_id from transactions (and lock it)
    const [rows] = await req.db.query(
      `SELECT user_id, track_id, status 
         FROM transactions 
        WHERE order_id = ? 
        FOR UPDATE`,
      [razorpay_order_id]
    );

    if (!rows || rows.length === 0) {
      return res.status(400).json({ msg: 'Transaction not found' });
    }

    const { user_id, track_id, status } = rows[0];

    // ✅ Step 3: Prevent duplicate success handling
    if (status === 'captured') {
      return res.json({ msg: 'success', description: 'alreadydone' });
    }

    // ✅ Step 4: Start DB transaction
    await req.db.query('START TRANSACTION');

    // ✅ Step 5: Mark transaction as success
    await req.db.query(
      `UPDATE transactions
          SET status = 'captured',
              razorpay_payment_id = ?,
              razorpay_signature = ?,
              updated_at = ?
        WHERE order_id = ?`,
      [razorpay_payment_id, razorpay_signature, now, razorpay_order_id]
    );

    // ✅ Step 6: Insert subscription entry (7-day validity)
    await req.db.query(
      `
      INSERT INTO subscriptions
        (user_id, track_id, status, start_date, end_date, created_at, updated_at)
      VALUES
        (?, ?, 'active', CURDATE(), DATE_ADD(CURDATE(), INTERVAL 7 DAY), ?, ?)
      ON DUPLICATE KEY UPDATE
        status = 'active',
        end_date = GREATEST(end_date, DATE_ADD(CURDATE(), INTERVAL 7 DAY)),
        updated_at = VALUES(updated_at)
      `,
      [user_id, track_id, now, now]
    );

    // ✅ Step 7: Commit
    await req.db.query('COMMIT');

    // ✅ Step 8: Return success for React Native WebView
    return res.json({ msg: 'success' });
  } catch (err) {
    try { await req.db.query('ROLLBACK'); } catch (_) {}
    console.error('razorpay-success error:', err);
    return res.status(500).json({ msg: 'Internal error' });
  }
});



/**
 * GET /api/users/:user_id/active-tracks
 * Returns all tracks the user is currently subscribed to
 * Rule: subscriptions.status='active' AND (end_date IS NULL OR end_date > CURDATE())
 * (Requires subscriptions.track_id to be set.)
 */
router.get('/users/:user_id/active-tracks', async (req, res) => {
  try {
    const uid = parseInt(req.params.user_id, 10);
    if (!uid) return res.status(400).json({ error: 'Valid user_id is required' });

    // 1) Get distinct track_ids from active subscriptions
    const [subRows] = await req.db.query(`
      SELECT DISTINCT track_id
      FROM subscriptions
      WHERE user_id = :uid
        AND track_id IS NOT NULL
        AND status = 'active'
        AND (end_date IS NULL OR end_date > CURDATE())
    `, { uid });

    if (!subRows.length) {
      return res.json({ user_id: uid, tracks: [] });
    }

    // Build dynamic placeholders for IN clause (mysql2 named placeholders)
    const ids = subRows.map(r => r.track_id).filter(Boolean);
    // De-dupe just in case
    const uniqIds = [...new Set(ids)];
    if (uniqIds.length === 0) {
      return res.json({ user_id: uid, tracks: [] });
    }

    const placeholders = uniqIds.map((_, i) => `:t${i}`).join(',');
    const params = { };
    uniqIds.forEach((id, i) => { params[`t${i}`] = id; });

    // 2) Fetch track details (with category)
    const [tracks] = await req.db.query(
      `
      SELECT
        t.id, t.title, t.description, t.thumbnail_path, t.mp3_path,
        t.price_paise, t.status, t.category_id, t.created_at,
        c.name AS category_name, c.slug AS category_slug
      FROM tracks t
      JOIN categories c ON c.id = t.category_id
      WHERE t.id IN (${placeholders})
      ORDER BY t.created_at DESC
      `,
      params
    );

    // Optional: include price in INR for convenience
    const toInr = (p) => Number(p || 0) / 100;
    const payload = tracks.map(t => ({
      id: t.id,
      title: t.title,
      description: t.description,
      thumbnail: t.thumbnail_path || null,
      mp3: t.mp3_path || null,
      price_paise: Number(t.price_paise || 0),
      price_inr: toInr(t.price_paise),
      status: t.status,
      category: { id: t.category_id, name: t.category_name, slug: t.category_slug },
      created_at: t.created_at
    }));

    return res.json({
      user_id: uid,
      count: payload.length,
      tracks: payload
    });
  } catch (e) {
    console.error('active-tracks error:', e);
    return res.status(500).json({ error: 'Failed to fetch active tracks' });
  }
});


module.exports = router;

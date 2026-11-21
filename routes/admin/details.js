'use strict';

const express = require('express');
const { requireAuth } = require('../../middleware/adminAuth');

const router = express.Router();

router.get('/users/lookup', requireAuth, async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q || q.length < 2) return res.json({ rows: [] });
  const [rows] = await req.db.query(
    `SELECT id, name, email FROM users WHERE name LIKE :q OR email LIKE :q ORDER BY created_at DESC LIMIT 15`,
    { q: `%${q}%` }
  );
  res.json({ rows });
});

router.get('/users/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const [users] = await req.db.query(`SELECT * FROM users WHERE id = :id LIMIT 1`, { id });
  if (!users[0]) {
    req.flash('error', 'User not found');
    return res.redirect('/admin/users');
  }
  let subs = [];
  try {
    const [rows] = await req.db.query(
      `SELECT s.*, t.title AS track_title, CAST(s.track_id AS CHAR) AS track_key
       FROM subscriptions s
       LEFT JOIN tracks t ON t.id = s.track_id
       WHERE s.user_id = :id
       ORDER BY s.created_at DESC
       LIMIT 25`,
      { id }
    );
    subs = rows;
  } catch {
    const [rows] = await req.db.query(
      `SELECT * FROM subscriptions WHERE user_id = :id ORDER BY created_at DESC LIMIT 25`,
      { id }
    );
    subs = rows;
  }
  const [txns] = await req.db.query(
    `SELECT * FROM transactions WHERE email = :email ORDER BY created_at DESC LIMIT 25`,
    { email: users[0].email }
  );
  const returnQs = String(req.query.return || '').trim();
  const {
    statusBadgeClass,
    formatStatusLabel,
  } = require('../../services/adminSubscriptionsService');
  const txDisplay = require('../../utils/adminTxDisplay');
  res.render('user-detail', {
    title: users[0].name || 'User',
    user: users[0],
    subscriptions: subs,
    transactions: txns,
    returnQs,
    subDisplay: { statusBadgeClass, formatStatusLabel },
    txDisplay,
  });
});

router.get('/transactions/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const [rows] = await req.db.query(`SELECT * FROM transactions WHERE id = :id LIMIT 1`, { id });
  if (!rows[0]) {
    req.flash('error', 'Transaction not found');
    return res.redirect('/admin/transactions');
  }
  let user = null;
  if (rows[0].email) {
    const [u] = await req.db.query(`SELECT id, name, email FROM users WHERE email = :email LIMIT 1`, {
      email: rows[0].email,
    });
    user = u[0] || null;
  }
  const txDisplay = require('../../utils/adminTxDisplay');
  const returnQs = String(req.query.return || '').trim();
  res.render('transaction-detail', {
    title: 'Transaction detail',
    txn: rows[0],
    user,
    txDisplay,
    returnQs,
  });
});

module.exports = router;
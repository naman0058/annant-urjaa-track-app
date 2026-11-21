'use strict';

const express = require('express');
const { requireAuth } = require('../../middleware/adminAuth');

const router = express.Router();

router.get('/search', requireAuth, async (req, res) => {
  const q = String(req.query.q || '').trim();
  let users = [];
  let txns = [];
  let subs = [];
  if (q.length >= 2) {
    const like = `%${q}%`;
    const [u] = await req.db.query(
      `SELECT id, name, email FROM users WHERE name LIKE :q OR email LIKE :q LIMIT 10`,
      { q: like }
    );
    users = u;
    const [t] = await req.db.query(
      `SELECT id, order_id, payment_id, email, status, amount FROM transactions
       WHERE order_id LIKE :q OR payment_id LIKE :q OR email LIKE :q OR receipt LIKE :q LIMIT 10`,
      { q: like }
    );
    txns = t;
    const qid = Number(q);
    if (Number.isInteger(qid) && qid > 0) {
      const [s] = await req.db.query(
        `SELECT s.id, s.status, u.email FROM subscriptions s INNER JOIN users u ON u.id = s.user_id WHERE s.id = :id LIMIT 5`,
        { id: qid }
      );
      subs = s;
    }
  }
  res.render('admin-search', { title: 'Search', q, users, txns, subs });
});

module.exports = router;
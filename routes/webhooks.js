const express = require('express')
const crypto = require('crypto')
const router = express.Router()

// Razorpay webhook handler
// Set RAZORPAY_WEBHOOK_SECRET in .env
router.post('/razorpay', express.json({ type: '*/*' }), async (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET
  if (!secret) return res.status(500).send('Webhook secret not set')

  const payload = JSON.stringify(req.body)
  const signature = req.get('x-razorpay-signature')
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex')

  if (!signature || signature !== expected) {
    return res.status(400).send('Invalid signature')
  }

  const event = req.body.event
  const entity = req.body.payload?.payment?.entity || req.body.payload?.order?.entity || {}

  try {
    const db = req.db
    if (event === 'payment.captured') {
      // Upsert transaction
      const email = entity.email || null
      await db.query(`
        INSERT INTO transactions (order_id, payment_id, receipt, email, amount, currency, status, method, created_at)
        VALUES (:order_id, :payment_id, :receipt, :email, :amount, :currency, 'captured', :method, FROM_UNIXTIME(:created_at))
        ON DUPLICATE KEY UPDATE status='captured', method=:method, email=:email, amount=:amount, currency=:currency
      `, {
        order_id: entity.order_id || '',
        payment_id: entity.id,
        receipt: entity.notes?.receipt || null,
        email,
        amount: entity.amount || 0,
        currency: entity.currency || 'INR',
        method: entity.method || null,
        created_at: entity.created || Math.floor(Date.now()/1000)
      })
    }
    // Add more events as needed
    res.json({ ok: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ ok: false })
  }
})

module.exports = router

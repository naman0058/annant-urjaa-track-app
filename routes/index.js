const express = require('express')
const router = express.Router()

router.get('/', (req, res) => {
  if (req.session && req.session.admin) {
    return res.redirect('/admin/dashboard')
  }
  res.redirect('/admin/login')
})



// payment/razorpay-success





module.exports = router

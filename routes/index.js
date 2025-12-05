const express = require('express')
const router = express.Router()


router.get('/admin', (req, res) => {
  if (req.session && req.session.admin) {
    return res.redirect('/admin/dashboard')
  }
  res.redirect('/admin/login')
})


router.get('/',(req,res)=>{
  res.render('index',{layout: false})
})


router.get('/about',(req,res)=>{
  res.render('about',{layout: false})
})


router.get('/why-pemf',(req,res)=>{
  res.render('whyPemf',{layout: false})
})


router.get('/programs',async (req,res)=>{
     const [rows] = await req.db.query('SELECT * FROM categories ')
  res.render('services',{layout: false,rows})
})


router.get('/contact',(req,res)=>{
  res.render('contact',{layout: false})
})

// payment/razorpay-success





module.exports = router

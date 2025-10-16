'use strict'
require('dotenv').config()
const path = require('path')
const express = require('express')
const session = require('express-session')
const MySQL = require('mysql2/promise')
const flash = require('connect-flash')
const morgan = require('morgan')
const helmet = require('helmet')
const expressLayouts = require('express-ejs-layouts');
const fs = require('fs');
const app = express()


const cors = require('cors');


app.use(cors());


const corsOptions = {
  origin: 'http://localhost:19006', // Your React Native Expo URL or other allowed origins
  optionsSuccessStatus: 200 // Some legacy browsers (IE11, various SmartTVs) choke on 204
};


// View engine
app.set('views', path.join(__dirname, 'views'))
app.set('view engine', 'ejs')

app.use(expressLayouts);
app.set('layout', 'partials/layout'); 

fs.mkdirSync(path.join(__dirname, 'public', 'uploads', 'categories'), { recursive: true });
fs.mkdirSync(path.join(__dirname, 'public', 'uploads', 'tracks'), { recursive: true });


// Middleware
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(express.static(path.join(__dirname, 'public')))
app.use(morgan('dev'))





app.use(session({
  secret: process.env.SESSION_SECRET || 'supersecret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 8 } // 8 hours
}))
app.use(flash())

// Database pool
const pool = MySQL.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'myappdb',
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true
})

app.use(async (req, res, next) => {
  req.db = pool
  res.locals.flash = { success: req.flash('success'), error: req.flash('error') }
  res.locals.session = req.session
  next()
})

// Routes
app.use('/', require('./routes/index'))
app.use('/admin', require('./routes/admin'))
app.use('/webhooks', require('./routes/webhooks'))
app.use('/api', require('./routes/api'));

// 404 handler
app.use((req, res, next) => {
  res.status(404).render('404', { title: 'Not Found' })
})

// Error handler
app.use((err, req, res, next) => {
  console.error(err)
  res.status(500).render('500', { title: 'Server Error', error: err })
})

module.exports = app

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

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
)


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
fs.mkdirSync(path.join(__dirname, 'public', 'uploads', 'blog'), { recursive: true });


// Middleware
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(
  '/uploads',
  express.static(path.join(__dirname, 'public', 'uploads'), { maxAge: '7d', etag: true })
)
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
  host: process.env.DB_HOST || '31.97.227.170',
  user: process.env.DB_USER || 'ananturjaa',
  password: process.env.DB_PASS || 'track@Anant123#urjaa',
  database: process.env.DB_NAME || 'itorus',
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

if (process.env.BLOG_IMPORT_WORKER_ENABLED === '1') {
  const { processImportBatch } = require('./services/import/folderImportProcessor');
  const batchLimit = parseInt(process.env.BLOG_IMPORT_BATCH_SIZE, 10) || 2;
  const importIntervalMs = Math.max(parseInt(process.env.BLOG_IMPORT_WORKER_INTERVAL_MS, 10) || 45_000, 10_000);
  const importTick = () => {
    if (!process.env.OPENAI_API_KEY) return;
    processImportBatch(pool, { limit: batchLimit })
      .then((r) => {
        if (r.processed > 0) console.log('blog import worker:', r.processed, 'items');
      })
      .catch((err) => console.error('blog import worker', err.message));
  };
  const importTimer = setInterval(importTick, importIntervalMs);
  if (typeof importTimer.unref === 'function') importTimer.unref();
  setTimeout(importTick, 12_000).unref?.();
}

if (process.env.BLOG_SCHEDULE_PUBLISH_ENABLED === '1') {
  const { processDueScheduledPosts } = require('./services/blogScheduledPublishService');
  const intervalMs = Math.max(parseInt(process.env.BLOG_SCHEDULE_PUBLISH_INTERVAL_MS, 10) || 60_000, 15_000);
  const tick = () => {
    processDueScheduledPosts(pool, { limit: 25 }).catch((err) => {
      console.error('blog schedule publish', err.message);
    });
  };
  const timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  setTimeout(tick, 5_000).unref?.();
}

// Routes
app.use('/', require('./routes/seo'))
app.use('/', require('./routes/blog'))
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

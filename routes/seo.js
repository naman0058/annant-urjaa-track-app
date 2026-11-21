'use strict';

const express = require('express');
const { buildSitemapXml } = require('../services/blogSitemapService');

const router = express.Router();

function siteBase(req) {
  const env = (process.env.SITE_BASE_URL || process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  if (env) return env;
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  return `${proto}://${req.get('host') || 'localhost'}`.replace(/\/$/, '');
}

router.get('/sitemap.xml', async (req, res) => {
  try {
    const xml = await buildSitemapXml(req.db, siteBase(req));
    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    res.send(xml);
  } catch (err) {
    console.error('sitemap', err.message);
    res.status(500).type('text/plain').send('Sitemap unavailable');
  }
});

router.get('/robots.txt', (req, res) => {
  const base = siteBase(req);
  const body = [
    'User-agent: *',
    'Disallow: /admin/',
    'Disallow: /admin',
    '',
    `Sitemap: ${base}/sitemap.xml`,
    '',
  ].join('\n');
  res.type('text/plain').send(body);
});

module.exports = router;
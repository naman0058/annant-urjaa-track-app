'use strict';

const express = require('express');
const { listBlogs, getBlogDetail } = require('../../services/blogMobileApiService');

const router = express.Router();

router.get('/blogs', async (req, res) => {
  try {
    const { limit, cursor } = req.query;
    const payload = await listBlogs(req.db, { limit, cursor });
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
    return res.json(payload);
  } catch (err) {
    if (err.code === 'INVALID_CURSOR') {
      return res.status(400).json({ error: 'Invalid cursor' });
    }
    console.error('GET /api/blogs', err.message);
    return res.status(500).json({ error: 'Failed to load blogs' });
  }
});

router.get('/blogs/:slug', async (req, res) => {
  try {
    const post = await getBlogDetail(req.db, req.params.slug);
    if (!post) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
    return res.json({ blog: post });
  } catch (err) {
    console.error('GET /api/blogs/:slug', err.message);
    return res.status(500).json({ error: 'Failed to load blog' });
  }
});

module.exports = router;
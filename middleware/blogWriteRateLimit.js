'use strict';

/** Lightweight in-memory rate limit for admin blog write/AI endpoints (per session admin id or IP). */
const buckets = new Map();

function blogWriteRateLimit({ windowMs = 60_000, max = 40 } = {}) {
  return (req, res, next) => {
    const key =
      (req.session?.admin?.id && `admin:${req.session.admin.id}`) ||
      `ip:${req.ip || req.socket?.remoteAddress || 'unknown'}`;
    const now = Date.now();
    let entry = buckets.get(key);
    if (!entry || now > entry.reset) {
      entry = { count: 0, reset: now + windowMs };
      buckets.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      if (req.accepts('json')) {
        return res.status(429).json({ error: 'Too many requests. Try again shortly.' });
      }
      req.flash?.('error', 'Too many requests. Please wait a minute and retry.');
      return res.redirect(req.get('Referer') || '/admin/blog');
    }
    return next();
  };
}

module.exports = { blogWriteRateLimit };
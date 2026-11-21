'use strict';

const buckets = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 20;

function clientKey(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function isLocked(req) {
  const entry = buckets.get(clientKey(req));
  if (!entry) return false;
  if (Date.now() - entry.start > WINDOW_MS) {
    buckets.delete(clientKey(req));
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

function recordFailedAttempt(req) {
  const key = clientKey(req);
  const now = Date.now();
  let entry = buckets.get(key);
  if (!entry || now - entry.start > WINDOW_MS) {
    entry = { start: now, count: 0 };
  }
  entry.count += 1;
  buckets.set(key, entry);
}

function adminLoginRateLimit(req, res, next) {
  if (isLocked(req)) {
    req.flash('error', 'Too many sign-in attempts. Please wait a few minutes and try again.')
    return res.redirect('/admin/login')
  }
  res.locals.recordLoginFailure = () => recordFailedAttempt(req);
  next();
}

module.exports = { adminLoginRateLimit, recordFailedAttempt };
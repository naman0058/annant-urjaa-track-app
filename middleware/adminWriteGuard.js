'use strict';

const { requireRole } = require('./adminAuth');

/** Block viewer role from mutating admin state (POST/PUT/PATCH/DELETE). */
function blockViewerWrites(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const role = req.session?.admin?.role;
  if (role === 'viewer') {
    req.flash('error', 'Your account is read-only.');
    return res.redirect(req.get('Referer') || '/admin/dashboard');
  }
  return next();
}

module.exports = { blockViewerWrites, requireRole };
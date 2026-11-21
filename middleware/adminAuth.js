'use strict';

const requireAuth = (req, res, next) => {
  if (req.session && req.session.admin) return next();
  return res.redirect('/admin/login');
};

const requireRole = (roles) => (req, res, next) => {
  const role = req.session?.admin?.role || 'viewer';
  if (roles.includes(role)) return next();
  req.flash('error', 'You do not have permission for that action');
  return res.redirect(req.get('Referer') || '/admin/dashboard');
};

module.exports = { requireAuth, requireRole };
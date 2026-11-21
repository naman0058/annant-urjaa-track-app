'use strict';

const crypto = require('crypto');

function issueCsrfToken(req) {
  if (!req.session) return '';
  if (!req.session._csrf) {
    req.session._csrf = crypto.randomBytes(32).toString('hex');
  }
  return req.session._csrf;
}

function csrfLocals(req, res, next) {
  res.locals.csrfToken = issueCsrfToken(req);
  next();
}

function isMultipartRequest(req) {
  const ct = String(req.get('content-type') || '');
  return ct.includes('multipart/form-data');
}

function verifyCsrfPost(req, res, next) {
  const headerTok = req.headers['x-csrf-token'];
  const bodyTok = req.body && req.body._csrf;
  const token = (typeof headerTok === 'string' && headerTok) || (typeof bodyTok === 'string' && bodyTok);
  if (!token || !req.session?._csrf || token !== req.session._csrf) {
    if (req.accepts('json')) {
      return res.status(403).json({ error: 'Invalid CSRF token' });
    }
    req.flash('error', 'Security token expired. Please try again.');
    const back = req.get('Referer') || '/admin/dashboard';
    return res.redirect(back);
  }
  return next();
}

/** Run multer first on multipart routes, then verifyCsrfPost. */
function shouldDeferCsrfToMultipartParser(req) {
  return req.method === 'POST' && isMultipartRequest(req);
}

module.exports = {
  csrfLocals,
  verifyCsrfPost,
  issueCsrfToken,
  isMultipartRequest,
  shouldDeferCsrfToMultipartParser,
};
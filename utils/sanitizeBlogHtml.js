'use strict';

const { sanitizePublicHtml } = require('./sanitizePublicHtml');

const SAFE_IMG_SRC = /^(https?:\/\/|\/uploads\/|\/images\/)/i;

/**
 * Sanitize HTML before persisting to blog_posts.content_html (allowlist display tags).
 */
function sanitizeBlogHtml(html) {
  let out = sanitizePublicHtml(html);
  if (!out.trim()) return '';

  out = out.replace(/<img\b([^>]*)>/gi, (full, attrs) => {
    const srcMatch = attrs.match(/\ssrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const src = srcMatch ? srcMatch[2] || srcMatch[3] || srcMatch[4] || '' : '';
    if (!src || !SAFE_IMG_SRC.test(src.trim())) return '';
    const altMatch = attrs.match(/\salt\s*=\s*("([^"]*)"|'([^']*)')/i);
    const alt = altMatch ? (altMatch[2] || altMatch[3] || '') : '';
    const safeAlt = String(alt).replace(/"/g, '&quot;').slice(0, 255);
    const safeSrc = String(src).replace(/"/g, '&quot;');
    return `<img src="${safeSrc}" alt="${safeAlt}">`;
  });

  return out.trim();
}

module.exports = { sanitizeBlogHtml };
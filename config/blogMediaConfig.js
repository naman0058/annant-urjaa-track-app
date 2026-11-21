'use strict';

function intEnv(name, fallback, { min = 1, max = 100 } = {}) {
  const raw = process.env[name];
  const n = raw === undefined || raw === '' ? fallback : parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function boolEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
}

const blogMediaConfig = Object.freeze({
  maxBytes: intEnv('BLOG_IMAGE_MAX_BYTES', 5 * 1024 * 1024, { min: 50_000, max: 20 * 1024 * 1024 }),
  maxWidth: intEnv('BLOG_IMAGE_MAX_WIDTH', 3840, { min: 1200, max: 8000 }),
  maxHeight: intEnv('BLOG_IMAGE_MAX_HEIGHT', 2160, { min: 675, max: 8000 }),
  minWidth: intEnv('BLOG_IMAGE_MIN_WIDTH', 640, { min: 320, max: 4000 }),
  minHeight: intEnv('BLOG_IMAGE_MIN_HEIGHT', 360, { min: 180, max: 4000 }),
  targetAspect: 16 / 9,
  aspectTolerance: 0.12,
  enableWebp: boolEnv('BLOG_IMAGE_ENABLE_WEBP', true),
  responsiveWidths: [400, 800, 1200],
  allowedMime: new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  uploadSubdir: 'blog',
});

module.exports = { blogMediaConfig };
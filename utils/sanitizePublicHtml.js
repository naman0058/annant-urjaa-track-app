'use strict';

/**
 * Server-side sanitizer for public blog HTML (display only — stored HTML unchanged).
 */
function sanitizePublicHtml(html) {
  let out = String(html || '');
  if (!out.trim()) return '';

  out = out.replace(/<script[\s\S]*?<\/script>/gi, '');
  out = out.replace(/<style[\s\S]*?<\/style>/gi, '');
  out = out.replace(/<iframe[\s\S]*?<\/iframe>/gi, '');
  out = out.replace(/<object[\s\S]*?<\/object>/gi, '');
  out = out.replace(/<embed[\s\S]*?>/gi, '');
  out = out.replace(/<link[\s\S]*?>/gi, '');
  out = out.replace(/<meta[\s\S]*?>/gi, '');
  out = out.replace(/<\/?(html|head|body)[^>]*>/gi, '');
  out = out.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  out = out.replace(/\s(href|src)\s*=\s*["']?\s*javascript:/gi, '');
  return out.trim();
}

module.exports = { sanitizePublicHtml };
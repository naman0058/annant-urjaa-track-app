'use strict';

const { stripHtml } = require('../ai/sourceSanitizer');
const { blogAiConfig } = require('../../config/blogAiConfig');

const SUPPORTED = new Set(['.md', '.markdown', '.txt', '.html', '.htm', '.json']);

function extensionOf(name) {
  const i = String(name || '').lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

function basicSanitizeHtml(html) {
  let out = String(html || '');
  out = out.replace(/<script[\s\S]*?<\/script>/gi, '');
  out = out.replace(/<iframe[\s\S]*?<\/iframe>/gi, '');
  out = out.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  out = out.replace(/javascript:/gi, '');
  return out.trim();
}

function textToHtml(plain) {
  const p = String(plain || '').trim();
  if (!p) return '';
  return p
    .split(/\n{2,}/)
    .map((block) => `<p>${block.replace(/\n/g, '<br>').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`)
    .join('\n');
}

function parseJsonArticle(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'Invalid JSON' };
  }
  if (!data || typeof data !== 'object') {
    return { ok: false, reason: 'JSON must be an object' };
  }
  const title =
    data.title || data.name || data.headline || null;
  const html =
    data.content_html ||
    data.html ||
    data.body_html ||
    (data.body && String(data.body).includes('<') ? data.body : null);
  const text =
    data.content_text ||
    data.body ||
    data.text ||
    data.markdown ||
    null;
  const content_html = html
    ? basicSanitizeHtml(html)
    : text
      ? textToHtml(text)
      : '';
  if (!content_html && !text) {
    return { ok: false, reason: 'JSON missing content fields' };
  }
  return {
    ok: true,
    title: title ? String(title).slice(0, 255) : null,
    content_html: content_html || textToHtml(text),
    plain: stripHtml(content_html) || String(text || ''),
  };
}

async function extractFromDocx(_buffer) {
  if (!blogAiConfig.importEnableDocx) {
    return { ok: false, reason: 'DOCX import is disabled (set BLOG_IMPORT_ENABLE_DOCX=1)' };
  }
  try {
    const mammoth = require('mammoth');
    const { value } = await mammoth.extractRawText({ buffer: _buffer });
    const plain = String(value || '').trim();
    if (!plain) return { ok: false, reason: 'DOCX contained no extractable text' };
    return { ok: true, title: null, content_html: textToHtml(plain), plain };
  } catch (e) {
    if (e.code === 'MODULE_NOT_FOUND') {
      return { ok: false, reason: 'DOCX parser not installed (mammoth)' };
    }
    return { ok: false, reason: `DOCX extraction failed: ${e.message}` };
  }
}

/**
 * @param {{ buffer: Buffer, fileName: string }} input
 */
async function extractContent({ buffer, fileName }) {
  const ext = extensionOf(fileName);
  const max = blogAiConfig.importMaxFileBytes;
  if (buffer.length > max) {
    return { ok: false, reason: `File exceeds size limit (${max} bytes)` };
  }

  if (ext === '.docx') {
    return extractFromDocx(buffer);
  }

  if (ext === '.pdf') {
    return { ok: false, reason: 'PDF import is not enabled (text extraction not configured)' };
  }

  if (!SUPPORTED.has(ext)) {
    return { ok: false, reason: `Unsupported file type ${ext || '(none)'}` };
  }

  const raw = buffer.toString('utf8');

  if (ext === '.json') {
    return parseJsonArticle(raw);
  }

  if (ext === '.html' || ext === '.htm') {
    const html = basicSanitizeHtml(raw);
    const plain = stripHtml(html);
    if (!plain) return { ok: false, reason: 'HTML file has no text content' };
    return { ok: true, title: null, content_html: html, plain };
  }

  const plain = ext === '.md' || ext === '.markdown' || ext === '.txt' ? raw.trim() : stripHtml(raw);
  if (!plain || plain.length < 40) {
    return { ok: false, reason: 'Content too short after extraction' };
  }
  return {
    ok: true,
    title: null,
    content_html: textToHtml(plain),
    plain,
  };
}

function isSupportedExtension(fileName) {
  const ext = extensionOf(fileName);
  if (SUPPORTED.has(ext)) return true;
  if (ext === '.docx' && blogAiConfig.importEnableDocx) return true;
  return false;
}

function unsupportedReason(fileName) {
  const ext = extensionOf(fileName);
  if (ext === '.pdf') return 'PDF not supported';
  if (ext === '.docx' && !blogAiConfig.importEnableDocx) return 'DOCX disabled by configuration';
  if (ext === '.docx') return 'DOCX (may require mammoth package)';
  if (!ext) return 'Missing file extension';
  return `Unsupported type ${ext}`;
}

module.exports = {
  extractContent,
  isSupportedExtension,
  unsupportedReason,
  extensionOf,
  basicSanitizeHtml,
};
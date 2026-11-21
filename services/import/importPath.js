'use strict';

const fs = require('fs');
const path = require('path');
const { blogAiConfig } = require('../../config/blogAiConfig');

function getImportRoot() {
  const base = blogAiConfig.importDir;
  if (!base || !String(base).trim()) {
    const err = new Error('BLOG_IMPORT_DIR is not configured on the server');
    err.code = 'IMPORT_DIR_MISSING';
    throw err;
  }
  return path.resolve(base);
}

/**
 * Resolve a relative subpath strictly inside the import root (no user absolute paths).
 */
function resolveInsideImportRoot(relativeSub = '.') {
  const root = getImportRoot();
  const cleaned = String(relativeSub || '.')
    .replace(/\\/g, '/')
    .replace(/\0/g, '')
    .trim();

  if (cleaned.includes('..') || path.isAbsolute(cleaned)) {
    const err = new Error('Invalid import path');
    err.code = 'IMPORT_PATH_INVALID';
    throw err;
  }

  const resolved = path.resolve(root, cleaned);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) {
    const err = new Error('Path escapes import directory');
    err.code = 'IMPORT_PATH_INVALID';
    throw err;
  }
  return resolved;
}

/**
 * Map relative posix path to absolute file under import root.
 */
function resolveRelativeFile(relativePosix) {
  const root = getImportRoot();
  const rel = String(relativePosix || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .trim();
  if (!rel || rel.includes('..')) {
    const err = new Error('Invalid file path');
    err.code = 'IMPORT_PATH_INVALID';
    throw err;
  }
  const resolved = path.resolve(root, rel.split('/').join(path.sep));
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (!resolved.startsWith(rootWithSep) && resolved !== root) {
    const err = new Error('Path escapes import directory');
    err.code = 'IMPORT_PATH_INVALID';
    throw err;
  }
  return resolved;
}

function isSafeRegularFile(absPath) {
  let st;
  try {
    st = fs.lstatSync(absPath);
  } catch {
    return { ok: false, reason: 'File not readable' };
  }
  if (st.isSymbolicLink()) {
    return { ok: false, reason: 'Symbolic links are not allowed' };
  }
  if (!st.isFile()) {
    return { ok: false, reason: 'Not a regular file' };
  }
  return { ok: true, size: st.size };
}

module.exports = {
  getImportRoot,
  resolveInsideImportRoot,
  resolveRelativeFile,
  isSafeRegularFile,
};
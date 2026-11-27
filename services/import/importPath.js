'use strict';

const fs = require('fs');
const path = require('path');
const { blogAiConfig } = require('../../config/blogAiConfig');

function assertImportDirConfigured() {
  const base = blogAiConfig.importDir;
  if (!base || !String(base).trim()) {
    const err = new Error('BLOG_IMPORT_DIR is not configured on the server');
    err.code = 'IMPORT_DIR_MISSING';
    throw err;
  }
}

function getImportBaseDir() {
  assertImportDirConfigured();
  const configured = blogAiConfig.importBaseDir && String(blogAiConfig.importBaseDir).trim();
  if (configured) return path.resolve(configured);
  return path.resolve(blogAiConfig.importDir, '..');
}

function normalizeRootRel(relativeFromBase) {
  const cleaned = String(relativeFromBase ?? '.')
    .replace(/\\/g, '/')
    .replace(/\0/g, '')
    .trim();
  if (!cleaned || cleaned === '.') return '.';
  if (cleaned.includes('..') || path.isAbsolute(cleaned)) {
    const err = new Error('Invalid import folder');
    err.code = 'IMPORT_PATH_INVALID';
    throw err;
  }
  return cleaned.replace(/^\/+/, '').replace(/\/+$/, '') || '.';
}

function assertInsideBase(absPath, base) {
  const resolved = path.resolve(absPath);
  const baseResolved = path.resolve(base);
  const baseWithSep = baseResolved.endsWith(path.sep) ? baseResolved : baseResolved + path.sep;
  if (resolved !== baseResolved && !resolved.startsWith(baseWithSep)) {
    const err = new Error('Path escapes import base directory');
    err.code = 'IMPORT_PATH_INVALID';
    throw err;
  }
  return resolved;
}

function getDefaultImportRootRel() {
  const base = getImportBaseDir();
  const root = path.resolve(blogAiConfig.importDir);
  const rel = path.relative(base, root);
  if (!rel || rel === '.') return '.';
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    const err = new Error('BLOG_IMPORT_DIR must be inside BLOG_IMPORT_BASE_DIR');
    err.code = 'IMPORT_PATH_INVALID';
    throw err;
  }
  return rel.split(path.sep).join('/');
}

/**
 * Absolute path of the selected import root (e.g. …/Blogs/2).
 * @param {string} [rootRel] posix path relative to import base; default from BLOG_IMPORT_DIR
 */
function getImportRoot(rootRel) {
  assertImportDirConfigured();
  const base = getImportBaseDir();
  const rel = normalizeRootRel(rootRel === undefined ? getDefaultImportRootRel() : rootRel);
  if (rel === '.') return assertInsideBase(base, base);
  return assertInsideBase(path.resolve(base, rel.split('/').join(path.sep)), base);
}

function listImportFolderChoices() {
  try {
    const base = getImportBaseDir();
    const defaultRootRel = getDefaultImportRootRel();
    if (!fs.existsSync(base)) {
      return { base, defaultRootRel, folders: [] };
    }
    const folders = fs
      .readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => ({
        value: d.name,
        label: d.name,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
    return { base, defaultRootRel, folders };
  } catch {
    return { base: '', defaultRootRel: '.', folders: [] };
  }
}

/**
 * Resolve a relative subpath strictly inside the import root (no user absolute paths).
 */
function resolveInsideImportRoot(relativeSub = '.', rootRel) {
  const root = getImportRoot(rootRel);
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
 * Map relative posix path to absolute file under a known scan/import root.
 */
function resolveFileUnderDirectory(rootDir, relativePosix) {
  const root = path.resolve(rootDir);
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

function resolveRelativeFile(relativePosix, rootDir) {
  const root = rootDir ? path.resolve(rootDir) : getImportRoot();
  return resolveFileUnderDirectory(root, relativePosix);
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
  getImportBaseDir,
  getDefaultImportRootRel,
  getImportRoot,
  listImportFolderChoices,
  resolveInsideImportRoot,
  resolveFileUnderDirectory,
  resolveRelativeFile,
  isSafeRegularFile,
};
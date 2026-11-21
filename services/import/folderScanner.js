'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { blogAiConfig } = require('../../config/blogAiConfig');
const { resolveInsideImportRoot, isSafeRegularFile } = require('./importPath');
const {
  isSupportedExtension,
  unsupportedReason,
  extensionOf,
} = require('./contentExtractor');

const HIDDEN = /(^|\/)\./;
const TEMP_NAME = /^(~|\._|\.#|tmp|temp|desktop\.ini$)/i;

function shouldSkipName(name) {
  if (!name || HIDDEN.test(name) || name.startsWith('.')) return true;
  if (TEMP_NAME.test(name)) return true;
  return false;
}

function toPosixRel(root, abs) {
  return path.relative(root, abs).split(path.sep).join('/');
}

const IN_CHUNK = 150;

async function markPreviouslyImported(db, entries) {
  const supported = entries.filter((e) => e.status === 'supported');
  if (!supported.length) return [];

  const paths = [...new Set(supported.map((e) => e.relativePath).filter(Boolean))];
  const hashes = [...new Set(supported.map((e) => e.fileHash).filter(Boolean))];

  const postsByPath = new Map();
  const postsByHash = new Map();
  const pathsFromJobs = new Set();

  for (let i = 0; i < paths.length; i += IN_CHUNK) {
    const chunk = paths.slice(i, i + IN_CHUNK);
    const ph = chunk.map((_, j) => `:p${j}`).join(',');
    const params = {};
    chunk.forEach((p, j) => {
      params[`p${j}`] = p;
    });
    const [rows] = await db.query(
      `SELECT id, title, slug, source_file, source_hash FROM blog_posts
       WHERE deleted_at IS NULL AND source_file IN (${ph})`,
      params
    );
    for (const r of rows) {
      if (r.source_file) postsByPath.set(r.source_file, r);
    }
  }

  for (let i = 0; i < hashes.length; i += IN_CHUNK) {
    const chunk = hashes.slice(i, i + IN_CHUNK);
    const ph = chunk.map((_, j) => `:h${j}`).join(',');
    const params = {};
    chunk.forEach((h, j) => {
      params[`h${j}`] = h;
    });
    const [rows] = await db.query(
      `SELECT id, title, slug, source_file, source_hash FROM blog_posts
       WHERE deleted_at IS NULL AND source_hash IN (${ph})`,
      params
    );
    for (const r of rows) {
      if (r.source_hash) postsByHash.set(r.source_hash, r);
    }
  }

  for (let i = 0; i < paths.length; i += IN_CHUNK) {
    const chunk = paths.slice(i, i + IN_CHUNK);
    const ph = chunk.map((_, j) => `:p${j}`).join(',');
    const params = {};
    chunk.forEach((p, j) => {
      params[`p${j}`] = p;
    });
    const [rows] = await db.query(
      `SELECT DISTINCT relative_path FROM blog_import_items
       WHERE status = 'completed' AND relative_path IN (${ph})`,
      params
    );
    for (const r of rows) {
      if (r.relative_path) pathsFromJobs.add(r.relative_path);
    }
  }

  const linkedPosts = [];
  for (const e of supported) {
    if (e.alreadyImported) continue;
    let post = null;
    if (postsByPath.has(e.relativePath)) post = postsByPath.get(e.relativePath);
    else if (e.fileHash && postsByHash.has(e.fileHash)) post = postsByHash.get(e.fileHash);
    else if (pathsFromJobs.has(e.relativePath)) {
      e.alreadyImported = true;
      e.importedViaJob = true;
      continue;
    }
    if (post) {
      e.alreadyImported = true;
      e.existingPost = post;
      linkedPosts.push(post);
    }
  }
  return linkedPosts;
}

/**
 * @param {{ subdir?: string, nested?: boolean, db?: object }} opts
 */
async function scanImportFolder(opts = {}) {
  const nested = opts.nested !== false && blogAiConfig.importNestedDirs;
  const root = resolveInsideImportRoot(opts.subdir || '.');

  if (!fs.existsSync(root)) {
    return {
      rootPath: root,
      configuredRoot: blogAiConfig.importDir,
      entries: [],
      summary: { total: 0, supported: 0, unsupported: 0, skipped: 0 },
      error: 'Import directory does not exist',
    };
  }

  const entries = [];
  const seen = new Set();

  function walk(dir) {
    let list;
    try {
      list = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of list) {
      if (shouldSkipName(d.name)) {
        entries.push({
          relativePath: toPosixRel(resolveInsideImportRoot(opts.subdir || '.'), path.join(dir, d.name)),
          status: 'skipped',
          reason: 'Hidden or temporary file',
        });
        continue;
      }
      const abs = path.join(dir, d.name);
      if (d.isDirectory()) {
        if (nested) walk(abs);
        continue;
      }
      if (!d.isFile()) continue;

      const relRoot = resolveInsideImportRoot(opts.subdir || '.');
      const relativePath = toPosixRel(relRoot, abs);
      if (seen.has(relativePath)) continue;
      seen.add(relativePath);

      const safe = isSafeRegularFile(abs);
      if (!safe.ok) {
        entries.push({ relativePath, status: 'skipped', reason: safe.reason });
        continue;
      }
      if (safe.size > blogAiConfig.importMaxFileBytes) {
        entries.push({
          relativePath,
          status: 'skipped',
          reason: `Exceeds ${blogAiConfig.importMaxFileBytes} byte limit`,
          size: safe.size,
        });
        continue;
      }

      const fileName = path.basename(abs);
      if (!isSupportedExtension(fileName)) {
        entries.push({
          relativePath,
          status: 'unsupported',
          reason: unsupportedReason(fileName),
          ext: extensionOf(fileName),
          size: safe.size,
        });
        continue;
      }

      let fileHash = null;
      try {
        const buf = fs.readFileSync(abs);
        fileHash = crypto.createHash('sha256').update(buf).digest('hex');
      } catch {
        entries.push({ relativePath, status: 'skipped', reason: 'Could not read file' });
        continue;
      }

      entries.push({
        relativePath,
        fileName,
        status: 'supported',
        size: safe.size,
        fileHash,
        ext: extensionOf(fileName),
      });
    }
  }

  walk(root);

  let previouslyImported = [];
  if (opts.db) {
    previouslyImported = await markPreviouslyImported(opts.db, entries);
  }

  const supported = entries.filter((e) => e.status === 'supported').length;
  const eligible = entries.filter((e) => e.status === 'supported' && !e.alreadyImported).length;
  const unsupported = entries.filter((e) => e.status === 'unsupported').length;
  const skipped = entries.filter((e) => e.status === 'skipped').length;

  return {
    rootPath: root,
    configuredRoot: blogAiConfig.importDir,
    nested,
    entries,
    previouslyImported,
    summary: {
      total: entries.length,
      supported,
      eligible,
      unsupported,
      skipped,
      alreadyImported: entries.filter((e) => e.alreadyImported).length,
    },
  };
}

module.exports = { scanImportFolder, shouldSkipName };
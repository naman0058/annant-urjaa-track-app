'use strict';

const crypto = require('crypto');
const path = require('path');

const MAX_SCANS = 4;
const SCAN_TTL_MS = 4 * 60 * 60 * 1000;

function friendlySourceLabel(subdir, configuredRoot) {
  const s = String(subdir || '.').trim() || '.';
  if (s === '.') {
    const base = configuredRoot ? path.basename(configuredRoot) : 'Import';
    return `${base} / Root`;
  }
  const rel = s.replace(/\\/g, '/').replace(/^\.\//, '');
  const parts = rel.split('/').filter(Boolean);
  const rootName = configuredRoot ? path.basename(configuredRoot) : 'Source';
  return parts.length ? `${rootName} / ${parts.join(' / ')}` : rootName;
}

function pruneScans(session) {
  if (!session.blogFolderScans) return;
  const now = Date.now();
  for (const [id, scan] of Object.entries(session.blogFolderScans)) {
    if (!scan?.createdAt || now - scan.createdAt > SCAN_TTL_MS) {
      delete session.blogFolderScans[id];
    }
  }
  const keys = Object.keys(session.blogFolderScans);
  while (keys.length > MAX_SCANS) {
    const oldest = keys.shift();
    delete session.blogFolderScans[oldest];
  }
}

function saveScan(session, scan, { subdir, nested }) {
  if (!session.blogFolderScans) session.blogFolderScans = {};
  const scanId = crypto.randomBytes(8).toString('hex');
  const createdAt = Date.now();
  session.blogFolderScans[scanId] = {
    ...scan,
    scanId,
    createdAt,
    subdir: subdir || '.',
    nested: nested !== false,
    configuredLabel: friendlySourceLabel(subdir, scan.configuredRoot),
  };
  session.blogFolderScanId = scanId;
  session.blogFolderScan = session.blogFolderScans[scanId];
  pruneScans(session);
  return scanId;
}

function getScan(session, scanId) {
  pruneScans(session);
  if (!scanId) return session.blogFolderScan || null;
  return session.blogFolderScans?.[scanId] || null;
}

function filterEntries(entries, { q, status, alreadyImported }) {
  let rows = entries || [];
  const term = String(q || '').trim().toLowerCase();
  if (term) {
    rows = rows.filter((e) => {
      const hay = `${e.relativePath || ''} ${e.fileName || ''} ${e.reason || ''}`.toLowerCase();
      return hay.includes(term);
    });
  }
  if (status && status !== 'all') {
    rows = rows.filter((e) => e.status === status);
  }
  if (alreadyImported === '1') {
    rows = rows.filter((e) => e.alreadyImported);
  } else if (alreadyImported === '0') {
    rows = rows.filter((e) => !e.alreadyImported);
  }
  return rows;
}

function paginateEntries(scan, { q, status, alreadyImported, page = 1, limit = 50 } = {}) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 10), 200);
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const rows = filterEntries(scan.entries, { q, status, alreadyImported });
  const total = rows.length;
  const offset = (safePage - 1) * safeLimit;
  return {
    rows: rows.slice(offset, offset + safeLimit),
    pagination: { page: safePage, limit: safeLimit, total },
  };
}

function displayStatus(entry) {
  if (entry.alreadyImported) return 'already_imported';
  return entry.status || 'unknown';
}

module.exports = {
  saveScan,
  getScan,
  paginateEntries,
  filterEntries,
  friendlySourceLabel,
  displayStatus,
};
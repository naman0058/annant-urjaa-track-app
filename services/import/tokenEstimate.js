'use strict';

const fs = require('fs');
const path = require('path');
const { resolveRelativeFile } = require('./importPath');
const { extractContent, extensionOf } = require('./contentExtractor');
const { estimateForFiles, estimateTokensForPlainChars } = require('./costEstimate');

const EXTRACT_CAP_BYTES = 512 * 1024;
const MAX_PLAIN_CHARS = 120_000;
const QUICK_EXTRACT_LIMIT = 40;

/**
 * Heuristic plain-text length — avoids using raw binary file size as token input.
 */
function heuristicPlainChars(entry) {
  const size = Number(entry.size) || 0;
  const ext = entry.ext || extensionOf(entry.relativePath || entry.fileName || '');
  if (ext === '.docx') {
    return Math.min(18_000, Math.max(800, Math.round(size / 12)));
  }
  if (ext === '.pdf') {
    return Math.min(8000, 2000);
  }
  if (['.html', '.htm'].includes(ext)) {
    return Math.min(MAX_PLAIN_CHARS, Math.round(size / 3));
  }
  if (['.json'].includes(ext)) {
    return Math.min(20_000, Math.round(size / 2));
  }
  return Math.min(MAX_PLAIN_CHARS, size);
}

async function plainCharsForEntry(entry, { tryExtract = false, scanRoot } = {}) {
  if (!tryExtract || !entry.relativePath) {
    return { chars: heuristicPlainChars(entry), quality: 'heuristic' };
  }
  try {
    const abs = resolveRelativeFile(entry.relativePath, scanRoot);
    const buf = fs.readFileSync(abs);
    const slice = buf.length > EXTRACT_CAP_BYTES ? buf.subarray(0, EXTRACT_CAP_BYTES) : buf;
    const extracted = await extractContent({ buffer: slice, fileName: entry.relativePath });
    if (extracted.ok && extracted.plain) {
      const chars = Math.min(MAX_PLAIN_CHARS, String(extracted.plain).length);
      return { chars: Math.max(chars, 200), quality: 'extracted' };
    }
  } catch {
    /* fallback */
  }
  return { chars: heuristicPlainChars(entry), quality: 'heuristic' };
}

async function buildFileEstimates(entries, { quickExtract = true, scanRoot } = {}) {
  const files = [];
  let qualities = new Set();
  let idx = 0;
  for (const entry of entries) {
    const tryExtract = quickExtract && idx < QUICK_EXTRACT_LIMIT;
    idx += 1;
    const { chars, quality } = await plainCharsForEntry(entry, { tryExtract, scanRoot });
    qualities.add(quality);
    files.push({
      relativePath: entry.relativePath,
      size: entry.size,
      estimatedChars: chars,
    });
  }
  let estimateQuality = 'heuristic';
  if (qualities.has('extracted') && !qualities.has('heuristic')) estimateQuality = 'extracted';
  else if (qualities.has('extracted')) estimateQuality = 'mixed';
  return { files, estimateQuality };
}

async function estimateEntries(entries, model, opts = {}) {
  const { files, estimateQuality } = await buildFileEstimates(entries, opts);
  const est = estimateForFiles(files, model);
  return {
    ...est,
    estimateQuality,
    assumptions:
      'Input/output tokens derived from extracted or heuristic text length (not binary file size). Actual API usage may differ.',
  };
}

module.exports = {
  heuristicPlainChars,
  plainCharsForEntry,
  estimateEntries,
  buildFileEstimates,
  estimateTokensForPlainChars,
};
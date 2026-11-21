'use strict';

const { blogAiConfig } = require('../../config/blogAiConfig');
const { scanImportFolder } = require('./folderScanner');
const { estimateEntries } = require('./tokenEstimate');
const { saveScan, friendlySourceLabel } = require('./scanSnapshot');
const { createJob, queueJob, getJob, listItems } = require('./folderImportRepository');
const { resolveCategoryId } = require('../ai/articleMapper');

function normalizeJobConfig(body = {}) {
  return {
    language: String(body.language || 'English').slice(0, 60),
    audience: String(body.audience || '').slice(0, 200),
    region: String(body.region || body.country || '').slice(0, 120),
    tone: String(body.tone || 'clear, authoritative, helpful').slice(0, 200),
    optional_category: String(body.optional_category || body.category || '').slice(0, 150),
    default_author: String(body.default_author || blogAiConfig.defaultAuthor).slice(0, 120),
    duplicate_hash: ['skip', 'review'].includes(body.duplicate_hash) ? body.duplicate_hash : 'skip',
    duplicate_slug: ['skip', 'suffix', 'review'].includes(body.duplicate_slug)
      ? body.duplicate_slug
      : 'suffix',
    import_mode: ['ai_rewrite', 'preserve_format', 'metadata_only'].includes(body.import_mode)
      ? body.import_mode
      : 'ai_rewrite',
    nested: body.nested === '1' || body.nested === true,
    subdir: String(body.subdir || '.').slice(0, 200),
    budget_max_usd: body.budget_max_usd ? parseFloat(body.budget_max_usd) : blogAiConfig.importBudgetUsd,
    auto_publish: resolveAutoPublish(body),
  };
}

function resolveAutoPublish(body = {}) {
  if (body.auto_publish === '0' || body.auto_publish === 0 || body.auto_publish === false) return false;
  if (body.auto_publish === '1' || body.auto_publish === 1 || body.auto_publish === true) return true;
  return blogAiConfig.importAutoPublish;
}

async function scanForAdmin(db, { subdir, nested }) {
  const scan = await scanImportFolder({
    subdir: subdir || '.',
    nested: nested !== false,
    db,
  });
  scan.subdir = subdir || '.';
  scan.configuredLabel = friendlySourceLabel(subdir, scan.configuredRoot);
  return scan;
}

function resolveEligibleEntries(scan, selectedPaths) {
  const set = selectedPaths && selectedPaths.length ? new Set(selectedPaths) : null;
  return (scan.entries || []).filter(
    (e) =>
      e.status === 'supported' &&
      !e.alreadyImported &&
      (!set || set.has(e.relativePath))
  );
}

async function estimateSelection(scan, selectedPaths, model, opts = {}) {
  const entries = resolveEligibleEntries(scan, selectedPaths);
  if (!entries.length) {
    return {
      fileCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
      estimateQuality: 'unavailable',
      assumptions: 'No eligible files selected.',
    };
  }
  return estimateEntries(entries, model || blogAiConfig.model, opts);
}

const { mapImportModeToAi } = require('./importMode');

async function startImportJob(db, { adminId, scan, selectedPaths, configBody, estimate, clientRequestId }) {
  if (clientRequestId) {
    const existing = await require('./folderImportRepository').findJobByClientRequest(
      db,
      adminId,
      clientRequestId
    );
    if (existing) {
      return {
        jobId: existing.id,
        jobKey: existing.job_key,
        selectedCount: existing.total_files,
        estimate,
        duplicate: true,
      };
    }
  }

  const config = normalizeJobConfig(configBody);
  config.ai_mode = mapImportModeToAi(config.import_mode);
  if (config.optional_category) {
    config.category_id = await resolveCategoryId(db, config.optional_category);
  }

  const set = new Set(selectedPaths || []);
  const selected = (scan.entries || []).filter(
    (e) => e.status === 'supported' && !e.alreadyImported && set.has(e.relativePath)
  );
  if (!selected.length) {
    const err = new Error('No supported files selected');
    err.code = 'NO_FILES';
    throw err;
  }

  const est = estimate || (await estimateSelection(scan, selectedPaths, blogAiConfig.model));

  const { jobId, jobKey } = await createJob(db, {
    adminId,
    scanRoot: scan.rootPath,
    selectedPaths: selected,
    model: blogAiConfig.model,
    config: { ...config, scan_subdir: config.subdir },
    clientRequestId,
  });

  await db.query(
    `
    UPDATE blog_import_jobs SET
      estimated_tokens = :tokens,
      estimated_cost_usd = :cost
    WHERE id = :id
    `,
    {
      id: jobId,
      tokens: est.totalTokens,
      cost: est.estimatedCostUsd,
    }
  );

  await queueJob(db, jobId);

  return { jobId, jobKey, selectedCount: selected.length, estimate: est };
}

async function getJobDashboard(db, jobId) {
  const job = await getJob(db, jobId);
  if (!job) return null;
  const items = await listItems(db, jobId);
  const total = Number(job.total_files) || items.length || 1;
  const done =
    items.filter((i) => ['completed', 'failed', 'skipped'].includes(i.status)).length;
  const progress = Math.round((done / total) * 100);
  return { job, items, progress };
}

module.exports = {
  scanForAdmin,
  estimateSelection,
  startImportJob,
  getJobDashboard,
  normalizeJobConfig,
  resolveAutoPublish,
  resolveEligibleEntries,
  mapImportModeToAi,
  saveScanSession: saveScan,
};
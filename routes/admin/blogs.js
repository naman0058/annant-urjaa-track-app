'use strict';

const express = require('express');
const fs = require('fs');
const { requireAuth, requireRole } = require('../../middleware/adminAuth');
const { verifyCsrfPost } = require('../../middleware/csrf');
const { blogAiConfig } = require('../../config/blogAiConfig');
const {
  scanForAdmin,
  estimateSelection,
  startImportJob,
  getJobDashboard,
  normalizeJobConfig,
  saveScanSession,
} = require('../../services/import/folderImportService');
const {
  getJob,
  pauseJob,
  resumeJob,
  cancelJob,
  retryFailedItems,
  listItems,
  recountJob,
  listJobs,
  getImportItem,
} = require('../../services/import/folderImportRepository');
const { processImportBatch } = require('../../services/import/folderImportProcessor');
const {
  resolveRelativeFile,
  listImportFolderChoices,
  getDefaultImportRootRel,
} = require('../../services/import/importPath');
const { extractContent, basicSanitizeHtml, extensionOf } = require('../../services/import/contentExtractor');
const { stripHtml } = require('../../services/ai/sourceSanitizer');
const { sanitizePublicHtml } = require('../../utils/sanitizePublicHtml');
const blogRepository = require('../../services/blogRepository');
const { getScan, paginateEntries, displayStatus } = require('../../services/import/scanSnapshot');
const { blogWriteRateLimit } = require('../../middleware/blogWriteRateLimit');
const { requireFolderImport } = require('../../middleware/blogAdminGuards');

const router = express.Router();
router.use(requireFolderImport);
const importRateLimit = blogWriteRateLimit({ windowMs: 60_000, max: 30 });
const canWrite = requireRole(['super', 'manager']);

function parseSelectedFiles(body) {
  if (Array.isArray(body.files)) return body.files.map(String);
  if (typeof body.files === 'string' && body.files.trim()) {
    return body.files.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function wantsJson(req) {
  return req.accepts('json') && req.get('X-Requested-With') === 'XMLHttpRequest';
}

function scanFromSession(req, scanId) {
  return getScan(req.session, scanId || req.body?.scanId || req.query?.scanId);
}

router.get('/import', requireAuth, canWrite, async (req, res) => {
  const scanId = req.session.blogFolderScanId || null;
  const scan = scanFromSession(req, scanId);
  let importFolders = { folders: [], defaultRootRel: '.', base: '' };
  try {
    if (blogAiConfig.importDir) importFolders = listImportFolderChoices();
  } catch (_) {
    /* ignore */
  }
  const currentImportRoot =
    req.session.blogImportRootRel || scan?.importRootRel || importFolders.defaultRootRel || '.';
  res.render('admin/blog-folder-import', {
    title: 'Import Blogs',
    importDir: blogAiConfig.importDir,
    importFolders,
    currentImportRoot,
    model: blogAiConfig.model,
    defaultAuthor: blogAiConfig.defaultAuthor,
    openaiConfigured: !!blogAiConfig.openaiApiKey,
    scan,
    scanId,
    config: req.session.blogFolderImportConfig || {},
    estimate: req.session.blogFolderEstimate || null,
    importBudgetUsd: blogAiConfig.importBudgetUsd,
    importAutoPublishDefault: blogAiConfig.importAutoPublish,
    showAbsoluteSource: req.session?.admin?.role === 'super',
  });
});

router.get('/jobs', requireAuth, canWrite, async (req, res) => {
  const page = req.query.page || 1;
  try {
    const { rows, pagination } = await listJobs(req.db, { page, limit: 25 });
    res.render('admin/blog-import-history', {
      title: 'Import History',
      jobs: rows,
      pagination,
    });
  } catch (err) {
    console.error('import history', err.message);
    res.render('admin/blog-import-history', {
      title: 'Import History',
      jobs: [],
      pagination: { page: 1, limit: 25, total: 0 },
    });
  }
});

async function handleScan(req, res) {
  try {
    if (!blogAiConfig.importDir) {
      const err = { error: 'BLOG_IMPORT_DIR is not configured.' };
      if (wantsJson(req)) return res.status(400).json(err);
      req.flash('error', err.error);
      return res.redirect('/admin/blogs/import');
    }
    const subdir = String(req.body.subdir || '.').trim();
    const nested = req.body.nested === '1' || req.body.nested === true;
    const importRoot = String(req.body.importRoot || req.session.blogImportRootRel || '').trim();
    let importRootRel;
    try {
      importRootRel = importRoot || getDefaultImportRootRel();
    } catch (e) {
      if (wantsJson(req)) return res.status(400).json({ error: e.message });
      req.flash('error', e.message);
      return res.redirect('/admin/blogs/import');
    }
    req.session.blogImportRootRel = importRootRel;
    const scan = await scanForAdmin(req.db, { subdir, nested, importRootRel });
    const scanId = saveScanSession(req.session, scan, { subdir, nested, importRootRel });
    req.session.blogFolderScan = scan;
    const payload = {
      ok: true,
      scanId,
      summary: scan.summary,
      configuredLabel: scan.configuredLabel,
    };
    if (wantsJson(req)) return res.json(payload);
    req.flash(
      'success',
      `Scan: ${scan.summary.supported} supported, ${scan.summary.skipped} skipped, ${scan.summary.alreadyImported} already imported.`
    );
    res.redirect('/admin/blogs/import');
  } catch (err) {
    console.error('import scan', err.message);
    if (wantsJson(req)) {
      return res.status(err.code === 'IMPORT_PATH_INVALID' ? 400 : 500).json({ error: err.message });
    }
    req.flash('error', err.code === 'IMPORT_PATH_INVALID' ? 'Invalid folder path.' : err.message);
    res.redirect('/admin/blogs/import');
  }
}

router.post('/import/scan', requireAuth, canWrite, verifyCsrfPost, handleScan);

router.get('/import/scan/:scanId/entries', requireAuth, canWrite, (req, res) => {
  const scan = scanFromSession(req, req.params.scanId);
  if (!scan) return res.status(404).json({ error: 'Scan expired. Scan again.' });
  const { rows, pagination } = paginateEntries(scan, {
    q: req.query.q,
    status: req.query.status,
    alreadyImported: req.query.alreadyImported,
    page: req.query.page,
    limit: req.query.limit,
  });
  const mapped = rows.map((e) => ({
    ...e,
    displayStatus: displayStatus(e),
    fileName: e.fileName || e.relativePath?.split('/').pop(),
    ext: e.ext || extensionOf(e.relativePath),
  }));
  res.json({ rows: mapped, pagination, summary: scan.summary, scanId: scan.scanId || req.params.scanId });
});

router.get('/import/folders', requireAuth, canWrite, (req, res) => {
  try {
    if (!blogAiConfig.importDir) {
      return res.json({ folders: [], defaultRootRel: '.', base: '' });
    }
    return res.json(listImportFolderChoices());
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/import/preview.json', requireAuth, canWrite, async (req, res) => {
  const rel = String(req.query.path || '').trim();
  if (!rel) return res.status(400).json({ error: 'Missing path' });
  const scan = scanFromSession(req, req.query.scanId || req.session.blogFolderScanId);
  try {
    const abs = resolveRelativeFile(rel, scan?.rootPath);
    const stat = fs.statSync(abs);
    const buf = fs.readFileSync(abs);
    const extracted = await extractContent({ buffer: buf, fileName: rel });
    if (!extracted.ok) {
      return res.json({
        ok: false,
        fileName: rel.split('/').pop(),
        relativePath: rel,
        size: stat.size,
        ext: extensionOf(rel),
        extractionStatus: 'failed',
        warnings: [extracted.reason],
      });
    }
    const plain = extracted.plain || stripHtml(extracted.content_html) || '';
    const html = basicSanitizeHtml(extracted.content_html || '');
    res.json({
      ok: true,
      fileName: rel.split('/').pop(),
      relativePath: rel,
      size: stat.size,
      ext: extensionOf(rel),
      extractionStatus: 'ok',
      plain: plain.slice(0, 80_000),
      content_html: sanitizePublicHtml(html).slice(0, 80_000),
      warnings: plain.length < 40 ? ['Very little text extracted'] : [],
    });
  } catch (err) {
    res.status(403).json({ error: 'Preview not allowed' });
  }
});

router.get('/import/preview', requireAuth, canWrite, async (req, res) => {
  const rel = String(req.query.path || '').trim();
  if (!rel) return res.status(400).send('Missing path');
  const scan = scanFromSession(req, req.query.scanId || req.session.blogFolderScanId);
  try {
    const abs = resolveRelativeFile(rel, scan?.rootPath);
    const buf = fs.readFileSync(abs);
    const extracted = await extractContent({ buffer: buf, fileName: rel });
    if (!extracted.ok) return res.status(400).send(extracted.reason);
    const plain = extracted.plain || stripHtml(extracted.content_html);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type('text/plain; charset=utf-8').send(plain.slice(0, 50_000));
  } catch {
    res.status(403).send('Preview not allowed');
  }
});

async function handleEstimate(req, res) {
  const scan = scanFromSession(req, req.body.scanId);
  const files = parseSelectedFiles(req.body);
  if (!scan) {
    if (wantsJson(req)) return res.status(400).json({ error: 'Scan the folder first.' });
    req.flash('error', 'Scan the folder first.');
    return res.redirect('/admin/blogs/import');
  }
  const model = req.body.model || blogAiConfig.model;
  const est = await estimateSelection(scan, files.length ? files : undefined, model);
  req.session.blogFolderEstimate = est;
  if (wantsJson(req)) return res.json({ ok: true, estimate: est, scanId: scan.scanId });
  req.flash(
    'success',
    `Estimate: ~${est.totalTokens.toLocaleString()} tokens, ~$${est.estimatedCostUsd} USD (${est.fileCount} files).`
  );
  res.redirect('/admin/blogs/import');
}

router.post('/import/estimate', requireAuth, canWrite, verifyCsrfPost, handleEstimate);

async function handleStart(req, res) {
  const scan = scanFromSession(req, req.body.scanId);
  const files = parseSelectedFiles(req.body);
  if (!scan) {
    if (wantsJson(req)) return res.status(400).json({ error: 'Scan the folder first.' });
    req.flash('error', 'Scan the folder first.');
    return res.redirect('/admin/blogs/import');
  }
  if (!blogAiConfig.openaiApiKey) {
    if (wantsJson(req)) return res.status(400).json({ error: 'OPENAI_API_KEY is not configured.' });
    req.flash('error', 'OPENAI_API_KEY is not configured.');
    return res.redirect('/admin/blogs/import');
  }
  if (req.body.confirm_cost !== '1' && req.body.confirm_cost !== 1) {
    if (wantsJson(req)) return res.status(400).json({ error: 'Cost confirmation required.' });
    req.flash('error', 'Confirm the estimated cost before starting.');
    return res.redirect('/admin/blogs/import');
  }

  const selected =
    files.length > 0
      ? files
      : scan.entries.filter((e) => e.status === 'supported' && !e.alreadyImported).map((e) => e.relativePath);

  if (!selected.length) {
    if (wantsJson(req)) return res.status(400).json({ error: 'No eligible files selected.' });
    req.flash('error', 'Select at least one eligible file.');
    return res.redirect('/admin/blogs/import');
  }

  req.session.blogFolderImportConfig = normalizeJobConfig(req.body);

  const clientRequestId = String(req.body.client_request_id || '').trim() || null;

  try {
    const est = await estimateSelection(scan, selected, req.body.model || blogAiConfig.model);
    if (blogAiConfig.importBudgetUsd > 0 && est.estimatedCostUsd > blogAiConfig.importBudgetUsd) {
      const msg = `Estimated cost $${est.estimatedCostUsd} exceeds budget $${blogAiConfig.importBudgetUsd}.`;
      if (wantsJson(req)) return res.status(400).json({ error: msg });
      req.flash('error', msg);
      return res.redirect('/admin/blogs/import');
    }
    const out = await startImportJob(req.db, {
      adminId: req.session.admin.id,
      scan,
      selectedPaths: selected,
      configBody: req.body,
      estimate: est,
      clientRequestId,
    });
    if (wantsJson(req)) {
      return res.json({ ok: true, jobId: out.jobId, jobKey: out.jobKey, duplicate: !!out.duplicate });
    }
    req.flash('success', `Import job ${out.jobKey} queued (${out.selectedCount} files).`);
    return res.redirect(`/admin/blogs/jobs/${out.jobId}`);
  } catch (err) {
    console.error('import start', err.message);
    if (wantsJson(req)) return res.status(500).json({ error: err.message || 'Could not start import' });
    req.flash('error', err.message || 'Could not start import');
    return res.redirect('/admin/blogs/import');
  }
}

router.post('/import/start', requireAuth, canWrite, importRateLimit, verifyCsrfPost, handleStart);

router.post('/import/process', requireAuth, canWrite, verifyCsrfPost, async (req, res) => {
  const jobId = parseInt(req.body.job_id, 10) || null;
  const limit = Math.min(parseInt(req.body.limit, 10) || blogAiConfig.importBatchSize, 10);
  try {
    const result = await processImportBatch(req.db, { jobId, limit });
    if (req.accepts('json') || wantsJson(req)) {
      return res.json(result);
    }
    req.flash('success', `Processed ${result.processed} item(s). ${result.message || ''}`);
    if (result.jobId) return res.redirect(`/admin/blogs/jobs/${result.jobId}`);
  } catch (err) {
    console.error('import process', err.message);
    if (wantsJson(req)) return res.status(500).json({ error: err.message });
    req.flash('error', err.message || 'Processing failed');
  }
  res.redirect(req.get('Referer') || '/admin/blogs/import');
});

router.get('/jobs/:id', requireAuth, canWrite, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const dash = await getJobDashboard(req.db, id);
  if (!dash) {
    req.flash('error', 'Job not found');
    return res.redirect('/admin/blogs/import');
  }
  res.render('admin/blog-import-job', {
    title: `Import in Progress`,
    ...dash,
    openaiConfigured: !!blogAiConfig.openaiApiKey,
    workerEnabled: process.env.BLOG_IMPORT_WORKER_ENABLED === '1',
  });
});

router.get('/jobs/:id/review', requireAuth, canWrite, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const dash = await getJobDashboard(req.db, id);
  if (!dash) {
    req.flash('error', 'Job not found');
    return res.redirect('/admin/blogs/jobs');
  }
  res.render('admin/blog-import-review', {
    title: 'Import Results',
    ...dash,
  });
});

router.get('/jobs/:id/items/:itemId/compare.json', requireAuth, canWrite, async (req, res) => {
  const jobId = parseInt(req.params.id, 10);
  const itemId = parseInt(req.params.itemId, 10);
  const item = await getImportItem(req.db, jobId, itemId);
  if (!item) return res.status(404).json({ error: 'Not found' });
  try {
    const job = await getJob(req.db, jobId);
    const abs = resolveRelativeFile(item.relative_path || item.file_name, job?.source_directory);
    const buf = fs.readFileSync(abs);
    const extracted = await extractContent({ buffer: buf, fileName: item.relative_path || item.file_name });
    let sourcePlain = extracted.ok ? extracted.plain || stripHtml(extracted.content_html) : '';
    let generatedHtml = '';
    if (item.post_id) {
      const post = await blogRepository.getPostById(req.db, item.post_id);
      generatedHtml = sanitizePublicHtml(post?.content_html || '');
      sourcePlain = sourcePlain || stripHtml(post?.content_html || '');
    }
    res.json({
      sourcePlain: String(sourcePlain || '').slice(0, 60_000),
      generatedHtml: String(generatedHtml || '').slice(0, 60_000),
      postId: item.post_id,
      status: item.status,
    });
  } catch (err) {
    res.status(400).json({ error: 'Compare unavailable' });
  }
});

router.get('/jobs/:id/status.json', requireAuth, canWrite, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await recountJob(req.db, id);
  const job = await getJob(req.db, id);
  if (!job) return res.status(404).json({ error: 'Not found' });
  const items = await listItems(req.db, id);
  const total = Number(job.total_files) || items.length || 1;
  const done = items.filter((i) => ['completed', 'failed', 'skipped'].includes(i.status)).length;
  const processing = items.find((i) => i.status === 'processing');
  res.json({
    job: {
      id: job.id,
      status: job.status,
      completed_count: job.completed_count,
      failed_count: job.failed_count,
      skipped_count: job.skipped_count,
      pending_count: job.pending_count,
      processing_count: job.processing_count,
      estimated_cost_usd: job.estimated_cost_usd,
      actual_cost_usd: job.actual_cost_usd,
      actual_tokens: job.actual_tokens,
      ai_model: job.ai_model,
    },
    progress: Math.round((done / total) * 100),
    currentFile: processing?.relative_path || processing?.file_name || null,
    items,
  });
});

router.post('/jobs/:id/pause', requireAuth, canWrite, verifyCsrfPost, async (req, res) => {
  await pauseJob(req.db, parseInt(req.params.id, 10));
  req.flash('success', 'Job paused.');
  res.redirect(`/admin/blogs/jobs/${req.params.id}`);
});

router.post('/jobs/:id/resume', requireAuth, canWrite, verifyCsrfPost, async (req, res) => {
  await resumeJob(req.db, parseInt(req.params.id, 10));
  req.flash('success', 'Job resumed.');
  res.redirect(`/admin/blogs/jobs/${req.params.id}`);
});

router.post('/jobs/:id/cancel', requireAuth, canWrite, verifyCsrfPost, async (req, res) => {
  await cancelJob(req.db, parseInt(req.params.id, 10));
  req.flash('success', 'Job cancelled.');
  res.redirect(`/admin/blogs/jobs/${req.params.id}`);
});

router.post('/jobs/:id/retry-failed', requireAuth, canWrite, verifyCsrfPost, async (req, res) => {
  await retryFailedItems(req.db, parseInt(req.params.id, 10));
  req.flash('success', 'Failed items re-queued.');
  res.redirect(`/admin/blogs/jobs/${req.params.id}`);
});

module.exports = router;
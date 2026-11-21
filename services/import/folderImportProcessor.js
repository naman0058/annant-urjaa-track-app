'use strict';

const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const { blogAiConfig, assertOpenAIConfigured } = require('../../config/blogAiConfig');
const { resolveRelativeFile } = require('./importPath');
const { extractContent, basicSanitizeHtml } = require('./contentExtractor');
const { generateArticleStructured } = require('../ai/openaiResponsesClient');
const { wrapUntrustedSource, extractAllowedUrls, stripHtml } = require('../ai/sourceSanitizer');
const { applyArticleToPost, resolveCategoryId } = require('../ai/articleMapper');
const blogRepository = require('../blogRepository');
const slugify = require('../../utils/slugify');
const { usageToCost } = require('./costEstimate');
const {
  getJob,
  listItems,
  recountJob,
  claimJob,
  touchJobHeartbeat,
  findNextQueuedJob,
  findPostBySourceHash,
  findSimilarTitle,
} = require('./folderImportRepository');
const { mapImportModeToAi, getImportRewriteUserDirective, getTitleAnchorDirective } = require('./importMode');
const { resolveAutoPublish } = require('./folderImportService');

function workerId() {
  return `${os.hostname()}-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
}

function defaultTitleFromPath(relativePath) {
  const base = relativePath.split('/').pop() || 'import';
  return base.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').slice(0, 200);
}

function titlesAligned(aiTitle, legacyTitle) {
  const a = String(aiTitle || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const b = String(legacyTitle || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const words = (s) => new Set(s.split(' ').filter((w) => w.length > 2));
  const wa = words(a);
  const wb = words(b);
  let overlap = 0;
  for (const w of wa) if (wb.has(w)) overlap += 1;
  return overlap >= Math.min(3, Math.ceil(Math.min(wa.size, wb.size) * 0.45));
}

async function skipItem(db, item, reason) {
  await db.query(
    `
    UPDATE blog_import_items SET status = 'skipped', skip_reason = :reason, completed_at = NOW()
    WHERE id = :id
    `,
    { id: item.id, reason: String(reason).slice(0, 500) }
  );
}

async function failItem(db, item, message) {
  await db.query(
    `
    UPDATE blog_import_items SET status = 'failed', error_message = :msg, completed_at = NOW(),
           attempt_count = attempt_count + 1
    WHERE id = :id
    `,
    { id: item.id, msg: String(message).slice(0, 2000) }
  );
}

async function processOneItem(db, job, item) {
  const config = job.config || {};
  const dupHash = config.duplicate_hash || 'skip';
  const dupSlug = config.duplicate_slug || 'suffix';

  await db.query(
    `UPDATE blog_import_items SET status = 'processing', started_at = NOW(), attempt_count = attempt_count + 1 WHERE id = :id`,
    { id: item.id }
  );

  const rel = item.relative_path || item.file_name;
  let absPath;
  try {
    absPath = resolveRelativeFile(rel);
  } catch (e) {
    await failItem(db, item, e.message);
    return;
  }

  const safeBuf = (() => {
    try {
      return fs.readFileSync(absPath);
    } catch (e) {
      return null;
    }
  })();
  if (!safeBuf) {
    await failItem(db, item, 'Could not read source file');
    return;
  }

  const fileHash = crypto.createHash('sha256').update(safeBuf).digest('hex');
  const extracted = await extractContent({ buffer: safeBuf, fileName: rel });
  if (!extracted.ok) {
    await skipItem(db, item, extracted.reason);
    return;
  }

  const existingHash = await findPostBySourceHash(db, fileHash);
  if (existingHash) {
    if (dupHash === 'skip') {
      await db.query(
        `
        UPDATE blog_import_items SET status = 'skipped', skip_reason = :reason, post_id = :post_id,
               file_hash = :hash, completed_at = NOW()
        WHERE id = :id
        `,
        {
          id: item.id,
          post_id: existingHash.id,
          hash: fileHash,
          reason: `Duplicate file hash (post #${existingHash.id})`,
        }
      );
      return;
    }
    if (dupHash === 'review') {
      await db.query(
        `
        UPDATE blog_import_items SET status = 'skipped', skip_reason = :reason, post_id = :post_id,
               file_hash = :hash, completed_at = NOW()
        WHERE id = :id
        `,
        {
          id: item.id,
          post_id: existingHash.id,
          hash: fileHash,
          reason: `Duplicate hash — linked for review (post #${existingHash.id})`,
        }
      );
      return;
    }
  }

  const importMode = config.import_mode || 'ai_rewrite';
  const freshReferenceRewrite = importMode === 'ai_rewrite';

  const titleGuess = extracted.title || defaultTitleFromPath(rel);
  const slugGuess = slugify(extracted.title || titleGuess);
  const titleDup = await findSimilarTitle(db, titleGuess);
  if (titleDup && dupSlug === 'skip') {
    await skipItem(db, item, `Similar title exists (post #${titleDup.id})`);
    return;
  }

  const content_html = basicSanitizeHtml(extracted.content_html);
  if (!stripHtml(content_html) || stripHtml(content_html).length < 40) {
    await skipItem(db, item, 'Insufficient content after validation');
    return;
  }

  const draftTitle = titleGuess;
  const draftHtml = freshReferenceRewrite
    ? `<!-- import-pending:${fileHash} --><p><em>AI blog draft will replace this placeholder.</em></p>`
    : content_html;
  const draftExcerpt = freshReferenceRewrite ? '' : stripHtml(content_html).slice(0, 300);

  let postId;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    postId = await blogRepository.createPost(
      conn,
      {
        title: draftTitle,
        slug: dupSlug === 'suffix' && titleDup ? undefined : slugGuess,
        content_html: draftHtml,
        excerpt: draftExcerpt,
        source_type: 'import',
        source_file: rel,
        source_hash: fileHash,
        author_name: config.default_author || blogAiConfig.defaultAuthor,
        status: 'draft',
        ai_review_status: 'none',
        featured_image: null,
      },
      job.created_by_admin_id
    );
    await conn.commit();
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
      /* ignore */
    }
    await failItem(db, item, err.message || 'Database create failed');
    conn.release();
    return;
  }
  conn.release();

  try {
    const allowedUrls = extractAllowedUrls(`${content_html}\n${config.source_url || ''}`);
    const wrapped = wrapUntrustedSource({
      title: titleGuess,
      html: content_html,
      plain: extracted.plain,
      sourceUrl: config.source_url || null,
      referenceMode: freshReferenceRewrite,
    });

    const editorial = {
      language: config.language || 'English',
      audience: config.audience || '',
      region: config.region || '',
      tone: config.tone || 'clear, authoritative, helpful',
    };

    const aiMode = mapImportModeToAi(importMode);
    const titleAnchor = freshReferenceRewrite ? getTitleAnchorDirective(titleGuess) : '';
    const importRewriteDirective = [getImportRewriteUserDirective(importMode), titleAnchor]
      .filter(Boolean)
      .join('\n\n');

    const { article, model, responseId, usage } = await generateArticleStructured({
      mode: aiMode,
      wrappedSource: wrapped,
      focusHint: config.focus_keyword || '',
      editorial: { ...editorial, legacyTitle: freshReferenceRewrite ? titleGuess : '' },
      importRewriteDirective,
    });

    if (freshReferenceRewrite && article?.title && !titlesAligned(article.title, titleGuess)) {
      article.title = titleGuess.slice(0, 200);
      if (article.slug_suggestion && !titlesAligned(article.slug_suggestion, titleGuess)) {
        article.slug_suggestion = null;
      }
    }

    await applyArticleToPost(db, postId, article, {
      mode: aiMode,
      allowedUrls,
      adminId: job.created_by_admin_id,
      aiModel: model,
      responseId,
      authorName: config.default_author || blogAiConfig.defaultAuthor,
      preserveSlug: false,
    });

    let categoryId = config.category_id || null;
    if (!categoryId && config.optional_category) {
      categoryId = await resolveCategoryId(db, config.optional_category);
    }

    const autoPublish = resolveAutoPublish(config);
    await db.query(
      `
      UPDATE blog_posts SET
        status = :status,
        published_at = IF(:status = 'published', COALESCE(published_at, NOW()), published_at),
        ai_generated = 1,
        ai_review_status = :ai_review_status,
        featured_image = NULL,
        category_id = COALESCE(:category_id, category_id),
        allow_indexing = IF(:status = 'published', 1, allow_indexing)
      WHERE id = :id
      `,
      {
        id: postId,
        category_id: categoryId,
        status: autoPublish ? 'published' : 'review',
        ai_review_status: autoPublish ? 'approved' : 'pending',
      }
    );
    if (autoPublish) {
      try {
        require('../blogPublicService').bustPublicCache();
      } catch {
        /* optional */
      }
    }

    const cost = usageToCost(usage, model);
    await db.query(
      `
      UPDATE blog_import_items SET
        status = 'completed',
        post_id = :post_id,
        file_hash = :hash,
        tokens_input = :ti,
        tokens_output = :to,
        completed_at = NOW(),
        result_json = :result_json
      WHERE id = :id
      `,
      {
        id: item.id,
        post_id: postId,
        hash: fileHash,
        ti: usage?.input_tokens ?? usage?.prompt_tokens ?? null,
        to: usage?.output_tokens ?? usage?.completion_tokens ?? null,
        result_json: JSON.stringify({ model, responseId, costUsd: cost }),
      }
    );

    if (cost > 0) {
      await db.query(
        `UPDATE blog_import_jobs SET actual_cost_usd = COALESCE(actual_cost_usd, 0) + :cost WHERE id = :id`,
        { cost, id: job.id }
      );
    }
    if (usage) {
      const total = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
      await db.query(
        `UPDATE blog_import_jobs SET actual_tokens = COALESCE(actual_tokens, 0) + :t WHERE id = :id`,
        { t: total, id: job.id }
      );
    }
  } catch (err) {
    await failItem(db, item, err.message || 'AI processing failed');
  }
}

/**
 * Process up to `limit` pending items for one job (or next queued job if jobId null).
 * Safe for cron — does not run on app start.
 */
async function processImportBatch(db, { jobId = null, limit = null, worker = null } = {}) {
  assertOpenAIConfigured();

  const batchLimit = Math.min(
    limit || blogAiConfig.importBatchSize,
    blogAiConfig.importBatchSize
  );
  const wid = worker || workerId();

  let targetJobId = jobId;
  if (!targetJobId) {
    targetJobId = await findNextQueuedJob(db);
  }
  if (!targetJobId) {
    return { processed: 0, message: 'No queued import jobs' };
  }

  const job = await getJob(db, targetJobId);
  if (!job || ['cancelled', 'paused', 'completed', 'failed'].includes(job.status)) {
    return { processed: 0, message: 'Job not runnable', jobId: targetJobId };
  }

  const claimed = await claimJob(db, targetJobId, wid);
  if (!claimed) {
    return { processed: 0, message: 'Could not claim job (locked)', jobId: targetJobId };
  }

  await db.query(
    `
    UPDATE blog_import_items SET status = 'pending', started_at = NULL
    WHERE job_id = :job_id AND status = 'processing'
      AND started_at IS NOT NULL
      AND started_at < (NOW() - INTERVAL :stale MINUTE)
    `,
    { job_id: targetJobId, stale: blogAiConfig.importWorkerStaleMinutes }
  );

  const [pending] = await db.query(
    `
    SELECT * FROM blog_import_items
    WHERE job_id = :job_id AND status = 'pending'
    ORDER BY id ASC
    LIMIT :limit
    `,
    { job_id: targetJobId, limit: batchLimit }
  );

  if (!pending.length) {
    await recountJob(db, targetJobId);
    await db.query(`UPDATE blog_import_jobs SET worker_lock = NULL WHERE id = :id`, {
      id: targetJobId,
    });
    return { processed: 0, jobId: targetJobId, message: 'No pending items' };
  }

  const budget = job.config?.budget_max_usd || blogAiConfig.importBudgetUsd;
  const [costRow] = await db.query(
    `SELECT actual_cost_usd FROM blog_import_jobs WHERE id = :id`,
    { id: targetJobId }
  );
  const spent = Number(costRow[0]?.actual_cost_usd) || 0;
  if (budget > 0 && spent >= budget) {
    await db.query(
      `UPDATE blog_import_jobs SET status = 'paused', error_summary = 'Budget limit reached' WHERE id = :id`,
      { id: targetJobId }
    );
    return { processed: 0, jobId: targetJobId, message: 'Budget guardrail triggered' };
  }

  let processed = 0;
  for (const item of pending) {
    const [st] = await db.query(`SELECT status FROM blog_import_jobs WHERE id = :id`, {
      id: targetJobId,
    });
    if (['paused', 'cancelled'].includes(st[0]?.status)) break;

    await touchJobHeartbeat(db, targetJobId);
    await processOneItem(db, job, item);
    processed += 1;
  }

  const stats = await recountJob(db, targetJobId);
  if (stats.pending === 0 && stats.processing === 0) {
    await db.query(
      `UPDATE blog_import_jobs SET worker_lock = NULL, status = 'completed', completed_at = NOW() WHERE id = :id AND status NOT IN ('paused','cancelled')`,
      { id: targetJobId }
    );
  } else {
    await db.query(
      `UPDATE blog_import_jobs SET worker_lock = NULL, status = IF(status='paused','paused','queued') WHERE id = :id`,
      { id: targetJobId }
    );
  }

  return { processed, jobId: targetJobId, stats };
}

module.exports = {
  processImportBatch,
  processOneItem,
  workerId,
};
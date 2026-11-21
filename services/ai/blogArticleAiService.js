'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { blogAiConfig, assertOpenAIConfigured } = require('../../config/blogAiConfig');
const { generateArticleStructured } = require('./openaiResponsesClient');
const {
  wrapUntrustedSource,
  stripHtml,
  extractAllowedUrls,
} = require('./sourceSanitizer');
const { applyArticleToPost } = require('./articleMapper');
const blogRepository = require('../blogRepository');
const { saveRevision } = require('../blogRevisionService');

async function logAudit(db, adminId, action, entityId, metadata) {
  await db.query(
    `
    INSERT INTO blog_audit_logs (admin_id, action, entity_type, entity_id, metadata_json)
    VALUES (:admin_id, :action, 'blog_post', :entity_id, :metadata_json)
    `,
    {
      admin_id: adminId,
      action,
      entity_id: entityId,
      metadata_json: JSON.stringify(metadata || {}),
    }
  );
}

async function rewriteExistingPost(db, postId, { mode = 'full', adminId, previewOnly = false } = {}) {
  assertOpenAIConfigured();
  const post = await blogRepository.getPostById(db, postId);
  if (!post) {
    const err = new Error('Post not found');
    err.code = 'NOT_FOUND';
    throw err;
  }

  await saveRevision(db, post, adminId, `before_ai_${mode}`);

  const allowedUrls = extractAllowedUrls(
    `${post.content_html || ''}\n${post.source_url || ''}`
  );
  const wrapped = wrapUntrustedSource({
    title: post.title,
    html: post.content_html,
    plain: stripHtml(post.content_html) || post.excerpt,
    sourceUrl: post.source_url,
  });

  const { article, model, responseId } = await generateArticleStructured({
    mode,
    wrappedSource: wrapped,
    focusHint: post.focus_keyword || '',
  });

  if (previewOnly) {
    return { preview: article, model, responseId, allowedUrls: [...allowedUrls] };
  }

  const result = await applyArticleToPost(db, postId, article, {
    mode,
    allowedUrls,
    adminId,
    aiModel: model,
    responseId,
    preservedAt: new Date().toISOString(),
    authorName: post.author_name || blogAiConfig.defaultAuthor,
  });

  await db.query(
    `UPDATE blog_posts SET source_type = 'ai' WHERE id = :id`,
    { id: postId }
  );

  await logAudit(db, adminId, `ai.rewrite.${mode}`, postId, {
    responseId,
    model,
    review_warnings: result.review_warnings,
  });

  return result;
}

function safeImportPath(userPath) {
  const base = blogAiConfig.importDir;
  if (!base) {
    const err = new Error('BLOG_IMPORT_DIR is not configured');
    err.code = 'IMPORT_DIR_MISSING';
    throw err;
  }
  const resolvedBase = path.resolve(base);
  const resolved = path.resolve(base, userPath || '.');
  if (!resolved.startsWith(resolvedBase)) {
    const err = new Error('Path escapes import directory');
    err.code = 'IMPORT_PATH_INVALID';
    throw err;
  }
  return resolved;
}

async function createDraftFromFile(db, filePath, adminId) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const baseName = path.basename(filePath, path.extname(filePath));
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const content_html = filePath.endsWith('.html') ? raw : `<p>${stripHtml(raw)}</p>`;

  const postId = await blogRepository.createPost(
    db,
    {
      title: baseName.replace(/[-_]/g, ' ').slice(0, 200),
      content_html,
      excerpt: stripHtml(raw).slice(0, 300),
      source_type: 'import',
      source_file: path.basename(filePath),
      source_hash: hash,
      author_name: blogAiConfig.defaultAuthor,
      status: 'draft',
    },
    adminId
  );
  return { postId, hash, filePath };
}

async function processImportFolder(db, { adminId, subdir = '.', limit = 10 } = {}) {
  assertOpenAIConfigured();
  const dir = safeImportPath(subdir);
  if (!fs.existsSync(dir)) {
    throw new Error('Import directory does not exist');
  }

  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .filter((n) => /\.(html|htm|md|txt)$/i.test(n))
    .slice(0, Math.min(limit, 25));

  const jobKey = crypto.randomBytes(10).toString('hex');
  const [jobRes] = await db.query(
    `
    INSERT INTO blog_import_jobs (
      job_key, job_type, source_directory, total_files, pending_count, status, ai_model, created_by_admin_id
    ) VALUES (:key, 'bulk_rewrite', :dir, :total, :pending, 'processing', :model, :admin_id)
    `,
    {
      key: jobKey,
      dir,
      total: entries.length,
      pending: entries.length,
      model: blogAiConfig.model,
      admin_id: adminId,
    }
  );
  const jobId = jobRes.insertId;

  const results = { completed: 0, failed: 0, skipped: 0, items: [] };

  for (const file of entries) {
    const full = path.join(dir, file);
    const fileHash = crypto
      .createHash('sha256')
      .update(fs.readFileSync(full))
      .digest('hex');

    const [existingItem] = await db.query(
      `SELECT id, post_id, status FROM blog_import_items WHERE job_id = :job_id AND file_hash = :hash LIMIT 1`,
      { job_id: jobId, hash: fileHash }
    );
    if (existingItem[0]?.status === 'completed') {
      results.skipped++;
      continue;
    }

    let itemId;
    try {
      const [itemIns] = await db.query(
        `
        INSERT INTO blog_import_items (job_id, file_name, file_hash, status, attempt_count, started_at)
        VALUES (:job_id, :file_name, :hash, 'processing', 1, NOW())
        ON DUPLICATE KEY UPDATE status = 'processing', attempt_count = attempt_count + 1, started_at = NOW()
        `,
        { job_id: jobId, file_name: file, hash: fileHash }
      );
      itemId = itemIns.insertId;

      const { postId } = await createDraftFromFile(db, full, adminId);
      const rewrite = await rewriteExistingPost(db, postId, { mode: 'full', adminId });

      await db.query(
        `
        UPDATE blog_import_items SET status = 'completed', post_id = :post_id, completed_at = NOW()
        WHERE job_id = :job_id AND file_name = :file_name
        `,
        { post_id: postId, job_id: jobId, file_name: file }
      );

      results.completed++;
      results.items.push({ file, postId, slug: rewrite.slug });
    } catch (err) {
      results.failed++;
      await db.query(
        `
        UPDATE blog_import_items SET status = 'failed', error_message = :msg, completed_at = NOW()
        WHERE job_id = :job_id AND file_name = :file_name
        `,
        { msg: String(err.message).slice(0, 2000), job_id: jobId, file_name: file }
      );
      results.items.push({ file, error: err.message });
    }
  }

  await db.query(
    `
    UPDATE blog_import_jobs SET
      completed_count = :completed,
      failed_count = :failed,
      skipped_count = :skipped,
      pending_count = 0,
      status = :status,
      completed_at = NOW()
    WHERE id = :id
    `,
    {
      id: jobId,
      completed: results.completed,
      failed: results.failed,
      skipped: results.skipped,
      status: results.failed && !results.completed ? 'failed' : 'completed',
    }
  );

  return { jobId, jobKey, ...results };
}

module.exports = {
  rewriteExistingPost,
  processImportFolder,
  createDraftFromFile,
  logAudit,
};
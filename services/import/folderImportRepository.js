'use strict';

const crypto = require('crypto');
const { blogAiConfig } = require('../../config/blogAiConfig');

function parseConfig(row) {
  if (!row?.config_json) return {};
  if (typeof row.config_json === 'object') return row.config_json;
  try {
    return JSON.parse(row.config_json);
  } catch {
    return {};
  }
}

/** Cached: idempotent import needs column; old DBs may lack it until migrate-blog-import-alter runs. */
let clientRequestIdColumnKnown = null;

async function supportsClientRequestId(db) {
  if (clientRequestIdColumnKnown !== null) return clientRequestIdColumnKnown;
  try {
    const [rows] = await db.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'blog_import_jobs' AND COLUMN_NAME = 'client_request_id'`
    );
    clientRequestIdColumnKnown = Number(rows[0]?.c) > 0;
  } catch {
    clientRequestIdColumnKnown = false;
  }
  return clientRequestIdColumnKnown;
}

/** For tests: reset module cache after mock schema changes. */
function _resetClientRequestIdColumnCacheForTests() {
  clientRequestIdColumnKnown = null;
}

async function createJob(db, { adminId, scanRoot, config, selectedPaths, model, clientRequestId }) {
  const jobKey = crypto.randomBytes(12).toString('hex');
  const total = selectedPaths.length;
  const baseParams = {
    job_key: jobKey,
    source_directory: scanRoot,
    total_files: total,
    pending_count: total,
    ai_model: model || blogAiConfig.model,
    config_json: JSON.stringify(config || {}),
    admin_id: adminId,
  };
  let res;
  try {
    [res] = await db.query(
      `
      INSERT INTO blog_import_jobs (
        job_key, job_type, source_directory, total_files,
        pending_count, processing_count, completed_count, failed_count, skipped_count,
        status, ai_model, config_json, created_by_admin_id, client_request_id
      ) VALUES (
        :job_key, 'directory_scan', :source_directory, :total_files,
        :pending_count, 0, 0, 0, 0,
        'pending', :ai_model, :config_json, :admin_id, :client_request_id
      )
      `,
      {
        ...baseParams,
        client_request_id: clientRequestId ? String(clientRequestId).slice(0, 64) : null,
      }
    );
  } catch (err) {
    if (!String(err.message || '').includes('client_request_id')) throw err;
    [res] = await db.query(
      `
      INSERT INTO blog_import_jobs (
        job_key, job_type, source_directory, total_files,
        pending_count, processing_count, completed_count, failed_count, skipped_count,
        status, ai_model, config_json, created_by_admin_id
      ) VALUES (
        :job_key, 'directory_scan', :source_directory, :total_files,
        :pending_count, 0, 0, 0, 0,
        'pending', :ai_model, :config_json, :admin_id
      )
      `,
      baseParams
    );
  }
  const jobId = res.insertId;

  for (const file of selectedPaths) {
    await db.query(
      `
      INSERT INTO blog_import_items (
        job_id, file_name, relative_path, file_hash, file_size_bytes, status
      ) VALUES (
        :job_id, :file_name, :relative_path, :file_hash, :file_size_bytes, 'pending'
      )
      `,
      {
        job_id: jobId,
        file_name: file.relativePath,
        relative_path: file.relativePath,
        file_hash: file.fileHash || null,
        file_size_bytes: file.size || null,
      }
    );
  }

  return { jobId, jobKey };
}

async function getJob(db, id) {
  const [rows] = await db.query(`SELECT * FROM blog_import_jobs WHERE id = :id LIMIT 1`, { id });
  const row = rows[0];
  if (!row) return null;
  row.config = parseConfig(row);
  return row;
}

async function getJobByKey(db, jobKey) {
  const [rows] = await db.query(`SELECT * FROM blog_import_jobs WHERE job_key = :key LIMIT 1`, {
    key: jobKey,
  });
  const row = rows[0];
  if (!row) return null;
  row.config = parseConfig(row);
  return row;
}

async function listItems(db, jobId) {
  const [rows] = await db.query(
    `
    SELECT id, job_id, file_name, relative_path, file_hash, file_size_bytes,
           status, attempt_count, error_message, skip_reason, post_id,
           tokens_input, tokens_output, started_at, completed_at, created_at
    FROM blog_import_items
    WHERE job_id = :job_id
    ORDER BY id ASC
    `,
    { job_id: jobId }
  );
  return rows;
}

async function recountJob(db, jobId) {
  const [counts] = await db.query(
    `
    SELECT
      SUM(status = 'pending') AS pending_count,
      SUM(status = 'processing') AS processing_count,
      SUM(status = 'completed') AS completed_count,
      SUM(status = 'failed') AS failed_count,
      SUM(status = 'skipped') AS skipped_count
    FROM blog_import_items WHERE job_id = :job_id
    `,
    { job_id: jobId }
  );
  const c = counts[0] || {};
  const pending = Number(c.pending_count) || 0;
  const processing = Number(c.processing_count) || 0;
  const completed = Number(c.completed_count) || 0;
  const failed = Number(c.failed_count) || 0;
  const skipped = Number(c.skipped_count) || 0;
  const total = pending + processing + completed + failed + skipped;

  let status = 'processing';
  if (pending === 0 && processing === 0) {
    if (failed > 0 && completed === 0) status = 'failed';
    else status = 'completed';
  }

  const [jobRow] = await db.query(`SELECT status FROM blog_import_jobs WHERE id = :id`, { id: jobId });
  const current = jobRow[0]?.status;
  if (current === 'paused' || current === 'cancelled') {
    status = current;
  }

  await db.query(
    `
    UPDATE blog_import_jobs SET
      pending_count = :pending,
      processing_count = :processing,
      completed_count = :completed,
      failed_count = :failed,
      skipped_count = :skipped,
      total_files = :total,
      status = IF(status IN ('paused','cancelled'), status, :status),
      completed_at = IF(:done, NOW(), completed_at),
      updated_at = NOW()
    WHERE id = :id
    `,
    {
      id: jobId,
      pending,
      processing,
      completed,
      failed,
      skipped,
      total,
      status,
      done: pending === 0 && processing === 0 ? 1 : 0,
    }
  );

  return { pending, processing, completed, failed, skipped, total, status };
}

async function queueJob(db, jobId) {
  await db.query(
    `UPDATE blog_import_jobs SET status = 'queued', started_at = COALESCE(started_at, NOW()) WHERE id = :id AND status IN ('pending','paused')`,
    { id: jobId }
  );
}

async function pauseJob(db, jobId) {
  await db.query(
    `UPDATE blog_import_jobs SET status = 'paused', worker_lock = NULL WHERE id = :id AND status IN ('queued','processing')`,
    { id: jobId }
  );
}

async function resumeJob(db, jobId) {
  await db.query(
    `UPDATE blog_import_jobs SET status = 'queued' WHERE id = :id AND status = 'paused'`,
    { id: jobId }
  );
}

async function cancelJob(db, jobId) {
  await db.query(
    `UPDATE blog_import_jobs SET status = 'cancelled', worker_lock = NULL, completed_at = NOW() WHERE id = :id`,
    { id: jobId }
  );
  await db.query(
    `UPDATE blog_import_items SET status = 'skipped', skip_reason = 'Job cancelled'
     WHERE job_id = :job_id AND status IN ('pending','processing')`,
    { job_id: jobId }
  );
}

async function retryFailedItems(db, jobId) {
  await db.query(
    `
    UPDATE blog_import_items SET status = 'pending', error_message = NULL, skip_reason = NULL,
           started_at = NULL, completed_at = NULL
    WHERE job_id = :job_id AND status = 'failed'
    `,
    { job_id: jobId }
  );
  await db.query(
    `UPDATE blog_import_jobs SET status = 'queued', completed_at = NULL WHERE id = :id`,
    { id: jobId }
  );
}

async function claimJob(db, jobId, workerId) {
  const staleMin = blogAiConfig.importWorkerStaleMinutes;
  const [res] = await db.query(
    `
    UPDATE blog_import_jobs SET
      status = 'processing',
      worker_lock = :worker,
      heartbeat_at = NOW()
    WHERE id = :id
      AND status IN ('queued','processing')
      AND (
        worker_lock IS NULL
        OR worker_lock = :worker
        OR heartbeat_at IS NULL
        OR heartbeat_at < (NOW() - INTERVAL :stale MINUTE)
      )
    `,
    { id: jobId, worker: workerId, stale: staleMin }
  );
  return res.affectedRows > 0;
}

async function touchJobHeartbeat(db, jobId) {
  await db.query(`UPDATE blog_import_jobs SET heartbeat_at = NOW() WHERE id = :id`, { id: jobId });
}

async function findNextQueuedJob(db) {
  const staleMin = blogAiConfig.importWorkerStaleMinutes;
  const [rows] = await db.query(
    `
    SELECT id FROM blog_import_jobs
    WHERE status IN ('queued','processing')
      AND pending_count > 0
      AND (
        worker_lock IS NULL
        OR heartbeat_at IS NULL
        OR heartbeat_at < (NOW() - INTERVAL :stale MINUTE)
      )
    ORDER BY created_at ASC
    LIMIT 1
    `,
    { stale: staleMin }
  );
  return rows[0]?.id || null;
}

async function findPostBySourceHash(db, hash) {
  if (!hash) return null;
  const [rows] = await db.query(
    `SELECT id, title, slug, source_hash FROM blog_posts WHERE source_hash = :hash AND deleted_at IS NULL LIMIT 1`,
    { hash }
  );
  return rows[0] || null;
}

async function findJobByClientRequest(db, adminId, clientRequestId) {
  if (!clientRequestId) return null;
  if (!(await supportsClientRequestId(db))) return null;
  const [rows] = await db.query(
    `
    SELECT id, job_key, total_files, created_at
    FROM blog_import_jobs
    WHERE created_by_admin_id = :admin_id
      AND client_request_id = :cid
      AND created_at > (NOW() - INTERVAL 5 MINUTE)
    ORDER BY id DESC LIMIT 1
    `,
    { admin_id: adminId, cid: String(clientRequestId).slice(0, 64) }
  );
  return rows[0] || null;
}

async function listJobs(db, { page = 1, limit = 20 } = {}) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 5), 100);
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const offset = (safePage - 1) * safeLimit;
  const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM blog_import_jobs`);
  const [rows] = await db.query(
    `
    SELECT j.id, j.job_key, j.status, j.total_files, j.completed_count, j.failed_count, j.skipped_count,
           j.estimated_cost_usd, j.actual_cost_usd, j.ai_model, j.created_at, j.completed_at,
           a.email AS admin_email
    FROM blog_import_jobs j
    LEFT JOIN admins a ON a.id = j.created_by_admin_id
    ORDER BY j.id DESC
    LIMIT :limit OFFSET :offset
    `,
    { limit: safeLimit, offset }
  );
  return { rows, pagination: { page: safePage, limit: safeLimit, total } };
}

async function getImportItem(db, jobId, itemId) {
  const [rows] = await db.query(
    `SELECT * FROM blog_import_items WHERE job_id = :job_id AND id = :id LIMIT 1`,
    { job_id: jobId, id: itemId }
  );
  return rows[0] || null;
}

async function findSimilarTitle(db, title) {
  if (!title) return null;
  const t = String(title).trim().slice(0, 200);
  const [rows] = await db.query(
    `SELECT id, title, slug FROM blog_posts WHERE deleted_at IS NULL AND title = :title LIMIT 1`,
    { title: t }
  );
  return rows[0] || null;
}

module.exports = {
  createJob,
  getJob,
  getJobByKey,
  listJobs,
  findJobByClientRequest,
  getImportItem,
  listItems,
  recountJob,
  queueJob,
  pauseJob,
  resumeJob,
  cancelJob,
  retryFailedItems,
  claimJob,
  touchJobHeartbeat,
  findNextQueuedJob,
  findPostBySourceHash,
  findSimilarTitle,
};
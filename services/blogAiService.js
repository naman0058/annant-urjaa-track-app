'use strict';

const crypto = require('crypto');
const { blogAiConfig, assertOpenAIConfigured } = require('../config/blogAiConfig');
const blogRepository = require('./blogRepository');
const blogArticleAi = require('./ai/blogArticleAiService');

async function queueJobs(db, postIds, jobType, adminId) {
  const batchId = crypto.randomBytes(10).toString('hex');
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    for (const postId of postIds) {
      await conn.query(
        `
        INSERT INTO blog_ai_jobs (job_type, status, post_id, batch_id, created_by_admin_id)
        VALUES (:job_type, 'queued', :post_id, :batch_id, :admin_id)
        `,
        { job_type: jobType, post_id: postId, batch_id: batchId, admin_id: adminId }
      );
    }
    await conn.commit();
    return { batchId, count: postIds.length };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function processQueuedJobs(db, limit = 5) {
  assertOpenAIConfigured();
  const [jobs] = await db.query(
    `
    SELECT * FROM blog_ai_jobs
    WHERE status = 'queued'
    ORDER BY id ASC
    LIMIT :limit
    `,
    { limit: Math.min(limit, 10) }
  );

  const results = { completed: 0, failed: 0, errors: [] };

  for (const job of jobs) {
    await db.query(
      `UPDATE blog_ai_jobs SET status = 'running', started_at = NOW() WHERE id = :id AND status = 'queued'`,
      { id: job.id }
    );

    try {
      const post = await blogRepository.getPostById(db, job.post_id);
      if (!post) throw new Error('Post not found');

      let mode = 'full';
      if (job.job_type === 'seo_generate' || job.job_type === 'seo_bulk' || job.job_type === 'article_metadata') {
        mode = 'metadata';
      } else if (job.job_type === 'article_content') {
        mode = 'content';
      } else if (job.job_type === 'rewrite_single' || job.job_type === 'rewrite_bulk') {
        mode = 'full';
      }

      const out = await blogArticleAi.rewriteExistingPost(db, job.post_id, {
        mode,
        adminId: job.created_by_admin_id,
      });

      await db.query(
        `
        UPDATE blog_ai_jobs SET status = 'completed', completed_at = NOW(),
          result_json = :result WHERE id = :id
        `,
        { id: job.id, result: JSON.stringify({ slug: out.slug, warnings: out.review_warnings }) }
      );
      results.completed++;
    } catch (err) {
      results.failed++;
      results.errors.push({ jobId: job.id, message: err.message });
      await db.query(
        `
        UPDATE blog_ai_jobs SET status = 'failed', completed_at = NOW(), error_message = :msg
        WHERE id = :id
        `,
        { id: job.id, msg: String(err.message).slice(0, 2000) }
      );
    }
  }

  return results;
}

async function listRecentJobs(db, limit = 20) {
  const [rows] = await db.query(
    `
    SELECT j.*, p.title AS post_title, p.slug AS post_slug
    FROM blog_ai_jobs j
    LEFT JOIN blog_posts p ON p.id = j.post_id
    ORDER BY j.id DESC
    LIMIT :limit
    `,
    { limit }
  );
  return rows;
}

async function countQueued(db) {
  const [[{ c }]] = await db.query(
    `SELECT COUNT(*) AS c FROM blog_ai_jobs WHERE status = 'queued'`
  );
  return c;
}

module.exports = {
  queueJobs,
  processQueuedJobs,
  listRecentJobs,
  countQueued,
  rewriteExistingPost: blogArticleAi.rewriteExistingPost,
  processImportFolder: blogArticleAi.processImportFolder,
  blogAiConfig,
};
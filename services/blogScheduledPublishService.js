'use strict';

async function listDueScheduledPosts(db, { limit = 20 } = {}) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const [rows] = await db.query(
    `
    SELECT id, title, slug, scheduled_at
    FROM blog_posts
    WHERE status = 'scheduled'
      AND deleted_at IS NULL
      AND scheduled_at IS NOT NULL
      AND scheduled_at <= NOW()
    ORDER BY scheduled_at ASC
    LIMIT :limit
    `,
    { limit: safeLimit }
  );
  return rows;
}

async function publishDuePost(db, id) {
  const [result] = await db.query(
    `
    UPDATE blog_posts
    SET status = 'published',
        published_at = COALESCE(scheduled_at, published_at, NOW())
    WHERE id = :id
      AND status = 'scheduled'
      AND deleted_at IS NULL
      AND scheduled_at IS NOT NULL
      AND scheduled_at <= NOW()
    `,
    { id }
  );
  if (result.affectedRows > 0) {
    try {
      require('./blogPublicService').bustPublicCache();
    } catch {
      /* optional */
    }
    return true;
  }
  return false;
}

async function processDueScheduledPosts(db, { limit = 20 } = {}) {
  const due = await listDueScheduledPosts(db, { limit });
  let published = 0;
  for (const row of due) {
    const ok = await publishDuePost(db, row.id);
    if (ok) published += 1;
  }
  return { checked: due.length, published };
}

module.exports = {
  listDueScheduledPosts,
  publishDuePost,
  processDueScheduledPosts,
};
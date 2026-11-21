'use strict';

async function nextRevisionNumber(db, postId) {
  const [[row]] = await db.query(
    `SELECT COALESCE(MAX(revision_number), 0) AS n FROM blog_revisions WHERE post_id = :post_id`,
    { post_id: postId }
  );
  return Number(row.n || 0) + 1;
}

async function saveRevision(db, post, adminId, changeSummary = 'snapshot') {
  if (!post?.id) return null;
  const rev = await nextRevisionNumber(db, post.id);
  const snapshot = { ...post };
  delete snapshot.password_hash;

  const [result] = await db.query(
    `
    INSERT INTO blog_revisions (post_id, revision_number, snapshot_json, change_summary, created_by_admin_id)
    VALUES (:post_id, :revision_number, :snapshot_json, :change_summary, :admin_id)
    `,
    {
      post_id: post.id,
      revision_number: rev,
      snapshot_json: JSON.stringify(snapshot),
      change_summary: changeSummary,
      admin_id: adminId,
    }
  );
  return { revisionId: result.insertId, revisionNumber: rev };
}

async function listRevisions(db, postId, limit = 20) {
  const [rows] = await db.query(
    `
    SELECT id, revision_number, change_summary, created_at, created_by_admin_id
    FROM blog_revisions
    WHERE post_id = :post_id
    ORDER BY revision_number DESC
    LIMIT :limit
    `,
    { post_id: postId, limit }
  );
  return rows;
}

module.exports = { saveRevision, listRevisions, nextRevisionNumber };
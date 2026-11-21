'use strict';

const slugify = require('../utils/slugify');

async function lookupTags(db, q, { limit = 15 } = {}) {
  const term = String(q || '').trim();
  if (!term) return [];
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 15, 1), 50);
  const like = `%${term.slice(0, 80)}%`;
  const [rows] = await db.query(
    `
    SELECT id, name, slug
    FROM blog_tags
    WHERE name LIKE :like
    ORDER BY name ASC
    LIMIT :limit
    `,
    { like, limit: safeLimit }
  );
  return rows;
}

async function listTags(db) {
  const [rows] = await db.query(
    `
    SELECT t.*, (
      SELECT COUNT(*) FROM blog_post_tags pt WHERE pt.tag_id = t.id
    ) AS post_count
    FROM blog_tags t
    ORDER BY t.name ASC
    `
  );
  return rows;
}

async function getPostTags(db, postId) {
  const [rows] = await db.query(
    `
    SELECT t.id, t.name, t.slug
    FROM blog_tags t
    INNER JOIN blog_post_tags pt ON pt.tag_id = t.id
    WHERE pt.post_id = :post_id
    ORDER BY t.name ASC
    `,
    { post_id: postId }
  );
  return rows;
}

function parseTagInput(input) {
  if (Array.isArray(input)) {
    return input.map((t) => String(t || '').trim()).filter(Boolean);
  }
  if (typeof input === 'string') {
    return input
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

async function syncPostTags(db, postId, input) {
  const names = parseTagInput(input);
  await db.query(`DELETE FROM blog_post_tags WHERE post_id = :post_id`, { post_id: postId });
  for (const raw of names) {
    const name = String(raw).slice(0, 100);
    const slug = slugify(name);
    let tagId;
    const [found] = await db.query(`SELECT id FROM blog_tags WHERE slug = :slug LIMIT 1`, { slug });
    if (found[0]) tagId = found[0].id;
    else {
      const [ins] = await db.query(`INSERT INTO blog_tags (name, slug) VALUES (:name, :slug)`, {
        name,
        slug,
      });
      tagId = ins.insertId;
    }
    await db.query(
      `INSERT IGNORE INTO blog_post_tags (post_id, tag_id) VALUES (:post_id, :tag_id)`,
      { post_id: postId, tag_id: tagId }
    );
  }
}

async function createTag(db, name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) {
    const err = new Error('Name is required');
    err.code = 'VALIDATION';
    throw err;
  }
  const slug = slugify(trimmed);
  const [found] = await db.query(`SELECT id FROM blog_tags WHERE slug = :slug LIMIT 1`, { slug });
  if (found[0]) return found[0].id;
  const [ins] = await db.query(`INSERT INTO blog_tags (name, slug) VALUES (:name, :slug)`, {
    name: trimmed.slice(0, 100),
    slug,
  });
  return ins.insertId;
}

async function deleteTag(db, id) {
  const [result] = await db.query(`DELETE FROM blog_tags WHERE id = :id`, { id });
  return result.affectedRows > 0;
}

module.exports = {
  lookupTags,
  listTags,
  getPostTags,
  syncPostTags,
  createTag,
  deleteTag,
  parseTagInput,
};
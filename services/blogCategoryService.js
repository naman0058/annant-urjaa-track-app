'use strict';

const slugify = require('../utils/slugify');

async function listCategories(db) {
  const [rows] = await db.query(
    `
    SELECT c.*, (
      SELECT COUNT(*) FROM blog_posts p
      WHERE p.category_id = c.id AND p.deleted_at IS NULL
    ) AS post_count
    FROM blog_categories c
    ORDER BY c.sort_order ASC, c.name ASC
    `
  );
  return rows;
}

async function getCategoryById(db, id) {
  const [rows] = await db.query(`SELECT * FROM blog_categories WHERE id = :id LIMIT 1`, { id });
  return rows[0] || null;
}

async function slugInUse(db, slug, excludeId = null) {
  const params = { slug };
  let sql = `SELECT id FROM blog_categories WHERE slug = :slug`;
  if (excludeId) {
    sql += ' AND id <> :excludeId';
    params.excludeId = excludeId;
  }
  sql += ' LIMIT 1';
  const [rows] = await db.query(sql, params);
  return !!rows.length;
}

async function createCategory(db, { name, description, meta_title, meta_description, sort_order }) {
  const trimmed = String(name || '').trim();
  if (!trimmed) {
    const err = new Error('Name is required');
    err.code = 'VALIDATION';
    throw err;
  }
  let slug = slugify(trimmed);
  let n = 0;
  while (await slugInUse(db, slug)) {
    n += 1;
    slug = `${slugify(trimmed)}-${n}`;
  }
  const [result] = await db.query(
    `
    INSERT INTO blog_categories (name, slug, description, meta_title, meta_description, sort_order)
    VALUES (:name, :slug, :description, :meta_title, :meta_description, :sort_order)
    `,
    {
      name: trimmed.slice(0, 150),
      slug,
      description: description ? String(description).trim().slice(0, 5000) : null,
      meta_title: meta_title ? String(meta_title).trim().slice(0, 70) : null,
      meta_description: meta_description ? String(meta_description).trim().slice(0, 320) : null,
      sort_order: Number.isFinite(parseInt(sort_order, 10)) ? parseInt(sort_order, 10) : 0,
    }
  );
  return result.insertId;
}

async function updateCategory(db, id, data) {
  const existing = await getCategoryById(db, id);
  if (!existing) return false;
  const name = data.name !== undefined ? String(data.name).trim().slice(0, 150) : existing.name;
  let slug = data.slug ? slugify(data.slug) : existing.slug;
  if (data.name && !data.slug) slug = slugify(name);
  if (slug !== existing.slug && (await slugInUse(db, slug, id))) {
    const err = new Error('Slug already in use');
    err.code = 'DUPLICATE_SLUG';
    throw err;
  }
  await db.query(
    `
    UPDATE blog_categories SET
      name = :name,
      slug = :slug,
      description = :description,
      meta_title = :meta_title,
      meta_description = :meta_description,
      sort_order = :sort_order
    WHERE id = :id
    `,
    {
      id,
      name,
      slug,
      description:
        data.description !== undefined
          ? data.description
            ? String(data.description).trim().slice(0, 5000)
            : null
          : existing.description,
      meta_title:
        data.meta_title !== undefined
          ? data.meta_title
            ? String(data.meta_title).trim().slice(0, 70)
            : null
          : existing.meta_title,
      meta_description:
        data.meta_description !== undefined
          ? data.meta_description
            ? String(data.meta_description).trim().slice(0, 320)
            : null
          : existing.meta_description,
      sort_order:
        data.sort_order !== undefined
          ? parseInt(data.sort_order, 10) || 0
          : existing.sort_order,
    }
  );
  return true;
}

async function deleteCategory(db, id) {
  const existing = await getCategoryById(db, id);
  if (!existing) return false;
  await db.query(`UPDATE blog_posts SET category_id = NULL WHERE category_id = :id`, { id });
  await db.query(`DELETE FROM blog_categories WHERE id = :id`, { id });
  return true;
}

module.exports = {
  listCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
};
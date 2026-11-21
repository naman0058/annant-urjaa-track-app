'use strict';

const express = require('express');
const { requireAuth, requireRole } = require('../../middleware/adminAuth');
const blogCategoryService = require('../../services/blogCategoryService');
const blogTagService = require('../../services/blogTagService');
const { logBlogAudit } = require('../../services/blogAuditService');

const router = express.Router();
const canWrite = requireRole(['super', 'manager']);

router.get('/categories', requireAuth, async (req, res) => {
  try {
    const categories = await blogCategoryService.listCategories(req.db);
    res.render('admin/blog-categories', {
      title: 'Blog categories',
      categories,
    });
  } catch (err) {
    console.error('blog categories list', err.message);
    req.flash('error', 'Could not load blog categories.');
    res.render('admin/blog-categories', { title: 'Blog categories', categories: [] });
  }
});

router.post('/categories', requireAuth, canWrite, async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) {
    req.flash('error', 'Category name is required.');
    return res.redirect('/admin/blog/categories');
  }
  try {
    const id = await blogCategoryService.createCategory(req.db, {
      name,
      description: req.body.description,
      meta_title: req.body.meta_title,
      meta_description: req.body.meta_description,
      sort_order: req.body.sort_order,
    });
    await logBlogAudit(req.db, {
      adminId: req.session.admin.id,
      action: 'category_create',
      entityType: 'blog_category',
      entityId: id,
      metadata: { name },
    });
    req.flash('success', 'Blog category created.');
  } catch (err) {
    req.flash('error', err.code === 'VALIDATION' ? err.message : 'Failed to create category.');
  }
  res.redirect('/admin/blog/categories');
});

router.post('/categories/:id', requireAuth, canWrite, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const ok = await blogCategoryService.updateCategory(req.db, id, {
      name: req.body.name,
      slug: req.body.slug,
      description: req.body.description,
      meta_title: req.body.meta_title,
      meta_description: req.body.meta_description,
      sort_order: req.body.sort_order,
    });
    if (!ok) req.flash('error', 'Category not found.');
    else {
      await logBlogAudit(req.db, {
        adminId: req.session.admin.id,
        action: 'category_update',
        entityType: 'blog_category',
        entityId: id,
      });
      req.flash('success', 'Category updated.');
    }
  } catch (err) {
    req.flash('error', err.code === 'DUPLICATE_SLUG' ? 'Slug already in use.' : 'Update failed.');
  }
  res.redirect('/admin/blog/categories');
});

router.post('/categories/:id/delete', requireAuth, canWrite, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const ok = await blogCategoryService.deleteCategory(req.db, id);
    if (!ok) req.flash('error', 'Category not found.');
    else {
      await logBlogAudit(req.db, {
        adminId: req.session.admin.id,
        action: 'category_delete',
        entityType: 'blog_category',
        entityId: id,
      });
      req.flash('success', 'Category removed (posts unlinked).');
    }
  } catch (err) {
    req.flash('error', 'Delete failed.');
  }
  res.redirect('/admin/blog/categories');
});

router.get('/tags', requireAuth, async (req, res) => {
  try {
    const tags = await blogTagService.listTags(req.db);
    res.render('admin/blog-tags', { title: 'Blog tags', tags });
  } catch (err) {
    console.error('blog tags list', err.message);
    req.flash('error', 'Could not load tags.');
    res.render('admin/blog-tags', { title: 'Blog tags', tags: [] });
  }
});

router.post('/tags', requireAuth, canWrite, async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) {
    req.flash('error', 'Tag name is required.');
    return res.redirect('/admin/blog/tags');
  }
  try {
    const id = await blogTagService.createTag(req.db, name);
    await logBlogAudit(req.db, {
      adminId: req.session.admin.id,
      action: 'tag_create',
      entityType: 'blog_tag',
      entityId: id,
      metadata: { name },
    });
    req.flash('success', 'Tag created.');
  } catch (err) {
    req.flash('error', 'Failed to create tag.');
  }
  res.redirect('/admin/blog/tags');
});

router.post('/tags/:id/delete', requireAuth, canWrite, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const ok = await blogTagService.deleteTag(req.db, id);
    if (!ok) req.flash('error', 'Tag not found.');
    else {
      await logBlogAudit(req.db, {
        adminId: req.session.admin.id,
        action: 'tag_delete',
        entityType: 'blog_tag',
        entityId: id,
      });
      req.flash('success', 'Tag deleted.');
    }
  } catch (err) {
    req.flash('error', 'Delete failed.');
  }
  res.redirect('/admin/blog/tags');
});

module.exports = router;
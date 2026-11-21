'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { requireAuth, requireRole } = require('../../middleware/adminAuth');
const { verifyCsrfPost } = require('../../middleware/csrf');
const blogRepository = require('../../services/blogRepository');
const blogImportService = require('../../services/blogImportService');
const blogAiService = require('../../services/blogAiService');
const blogArticleAi = require('../../services/ai/blogArticleAiService');
const { listRevisions } = require('../../services/blogRevisionService');
const { blogAiConfig } = require('../../config/blogAiConfig');
const { blogMediaConfig } = require('../../config/blogMediaConfig');
const blogFeaturedImage = require('../../services/blogFeaturedImageService');
const { recommendLinksForPost } = require('../../services/blogInternalLinksService');
const { blogWriteRateLimit } = require('../../middleware/blogWriteRateLimit');
const blogCategoryService = require('../../services/blogCategoryService');
const blogTagService = require('../../services/blogTagService');
const { logBlogAudit } = require('../../services/blogAuditService');
const { blogAdminConfig } = require('../../config/blogAdminConfig');
const {
  requireBlogCms,
  requireBlogNewPost,
  requireBlogImportCsv,
  requireBlogAi,
  requireBlogTrash,
} = require('../../middleware/blogAdminGuards');
const { sanitizePublicHtml } = require('../../utils/sanitizePublicHtml');
const { injectHeadingIds } = require('../../utils/blogToc');
const { buildArticleGraph, parseContentJson } = require('../../utils/jsonLdBlog');
const { buildArticleSeoMeta } = require('../../services/blogSeoMeta');
const { buildResponsiveImage } = require('../../utils/blogImageView');
const { siteSeoConfig } = require('../../config/siteSeoConfig');
const blogPublic = require('../../services/blogPublicService');

const router = express.Router();
router.use(requireBlogCms);
const aiRateLimit = blogWriteRateLimit({ windowMs: 60_000, max: 25 });
const autosaveRateLimit = blogWriteRateLimit({ windowMs: 60_000, max: 120 });
const canWrite = requireRole(['super', 'manager']);

const blogUploadDir = path.join(__dirname, '..', '..', 'public', 'uploads', 'blog');
fs.mkdirSync(blogUploadDir, { recursive: true });

const uploadFeaturedMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: blogMediaConfig.maxBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!blogMediaConfig.allowedMime.has(file.mimetype)) {
      return cb(new Error('Only JPEG, PNG, WebP, or GIF images are allowed'));
    }
    cb(null, true);
  },
});

function parsePostIds(input) {
  if (Array.isArray(input)) return input.map(Number).filter(Boolean);
  if (typeof input === 'string' && input.trim()) {
    return input.split(',').map((s) => parseInt(s, 10)).filter(Boolean);
  }
  return [];
}

function parseCategoryId(body) {
  const n = parseInt(body.category_id, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function autosaveEnabled() {
  return process.env.BLOG_AUTOSAVE_ENABLED !== '0';
}

function previewSiteBase() {
  return (
    process.env.SITE_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    ''
  ).replace(/\/$/, '');
}

function parseScheduledAt(input) {
  if (!input) return null;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

function autosavePayloadToPostFields(body) {
  const title = String(body.title || '').trim() || 'Untitled draft';
  return {
    title,
    slug: body.slug,
    excerpt: body.excerpt,
    content_html: body.content_html,
    status: ['draft', 'review', 'scheduled', 'archived'].includes(body.status) ? body.status : 'draft',
    featured_image_alt: String(body.featured_image_alt || '').trim().slice(0, 255) || null,
    meta_title: body.meta_title,
    meta_description: body.meta_description,
    meta_keywords: body.meta_keywords,
    canonical_url: body.canonical_url,
    og_title: body.og_title,
    og_description: body.og_description,
    robots_directive: body.robots || body.robots_directive,
    scheduled_at: parseScheduledAt(body.scheduled_at),
    source_url: body.source_url,
    category_id: parseCategoryId(body),
  };
}

const featuredErrorMessages = {
  IMAGE_TOO_LARGE: 'Image file is too large.',
  IMAGE_SIGNATURE: 'File is not a valid image.',
  IMAGE_MIME_MISMATCH: 'File type does not match contents.',
  IMAGE_TOO_SMALL: (err) => err.message,
  IMAGE_BLOCKED: 'Upload rejected for security reasons.',
  IMAGE_PROCESSOR: 'Image processing is not available on the server.',
};

async function applyFeaturedUploadFromRequest(req, postId) {
  if (!req.file) return null;
  const processed = await blogFeaturedImage.processAndStore({
    buffer: req.file.buffer,
    mimetype: req.file.mimetype,
    originalname: req.file.originalname,
    postId,
  });
  const alt = req.body.featured_image_alt;
  return blogFeaturedImage.applyFeaturedImage(req.db, postId, processed, alt);
}

function flashFeaturedError(req, err) {
  const map = featuredErrorMessages;
  const msg =
    typeof map[err.code] === 'function'
      ? map[err.code](err)
      : map[err.code] || 'Could not process image.';
  req.flash('error', msg);
}

router.use(require('./blogTaxonomy'));

router.get('/trash', requireAuth, canWrite, requireBlogTrash, async (req, res) => {
  const page = req.query.page || 1;
  try {
    const { rows, pagination } = await blogRepository.listTrashedPosts(req.db, { page, limit: 20 });
    res.render('admin/blog-trash', { title: 'Blog trash', posts: rows, pagination });
  } catch (err) {
    console.error('blog trash', err.message);
    req.flash('error', 'Could not load trash.');
    res.render('admin/blog-trash', {
      title: 'Blog trash',
      posts: [],
      pagination: { page: 1, limit: 20, total: 0 },
    });
  }
});

router.post('/trash/:id/restore', requireAuth, canWrite, requireBlogTrash, verifyCsrfPost, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const out = await blogRepository.restorePost(req.db, id, { status: 'draft' });
    if (!out.ok) {
      req.flash('error', 'Post not in trash.');
    } else {
      await logBlogAudit(req.db, {
        adminId: req.session.admin.id,
        action: 'post_restore',
        entityType: 'blog_post',
        entityId: id,
        metadata: { slug: out.slug, status: out.status },
      });
      const extra = out.slug ? ` Slug: ${out.slug}.` : '';
      req.flash('success', `Post restored as draft.${extra}`);
    }
  } catch (err) {
    req.flash('error', 'Restore failed.');
  }
  res.redirect('/admin/blog/trash');
});

router.post('/trash/:id/purge', requireAuth, requireRole(['super']), requireBlogTrash, verifyCsrfPost, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const trashed = await blogRepository.getTrashedPostById(req.db, id);
  if (!trashed) {
    req.flash('error', 'Post not in trash.');
    return res.redirect('/admin/blog/trash');
  }
  try {
    await blogRepository.deletePost(req.db, id, { hard: true });
    await logBlogAudit(req.db, {
      adminId: req.session.admin.id,
      action: 'post_purge',
      entityType: 'blog_post',
      entityId: id,
      metadata: { slug: trashed.slug },
    });
    req.flash('success', 'Post permanently deleted.');
  } catch (err) {
    req.flash('error', 'Permanent delete failed.');
  }
  res.redirect('/admin/blog/trash');
});

function countBlogActiveFilters(filters) {
  let n = 0;
  if (String(filters.q || '').trim()) n++;
  if (filters.status && filters.status !== 'all') n++;
  if (filters.sort && filters.sort !== 'updated_at') n++;
  if (filters.dir && filters.dir !== 'desc') n++;
  if (filters.limit && Number(filters.limit) !== 20) n++;
  return n;
}

function blogListHasUserFilters(filters) {
  return countBlogActiveFilters(filters) > 0;
}

router.get('/', requireAuth, async (req, res) => {
  const filters = {
    q: String(req.query.q || '').trim(),
    status: String(req.query.status || 'all'),
    sort: String(req.query.sort || 'updated_at'),
    dir: String(req.query.dir || 'desc'),
    limit: String(req.query.limit || '20'),
  };
  const page = req.query.page || 1;
  const limit = filters.limit;

  try {
    const { rows, pagination } = await blogRepository.listPosts(req.db, {
      ...filters,
      page,
      limit,
    });
    const queuedAi = await blogAiService.countQueued(req.db).catch(() => 0);
    res.render('admin/blog-list', {
      title: 'Blog',
      posts: rows,
      pagination,
      filters,
      queuedAi,
      activeFilterCount: countBlogActiveFilters(filters),
      datasetEmpty: Number(pagination.total) === 0 && !blogListHasUserFilters(filters),
    });
  } catch (err) {
    console.error('admin blog list', err.message);
    req.flash('error', 'Could not load blog posts. Run npm run migrate:blog if this is a fresh install.');
    res.render('admin/blog-list', {
      title: 'Blog',
      posts: [],
      pagination: { page: 1, limit: 20, total: 0 },
      filters,
      queuedAi: 0,
      activeFilterCount: countBlogActiveFilters(filters),
      datasetEmpty: false,
    });
  }
});

router.get('/new', requireAuth, canWrite, requireBlogNewPost, async (req, res) => {
  const categories = await blogCategoryService.listCategories(req.db).catch(() => []);
  res.render('admin/blog-edit', {
    title: 'New Blog Post',
    post: null,
    mode: 'create',
    categories,
    postTags: [],
    linkSuggestions: null,
    imageMaxMb: Math.round(blogMediaConfig.maxBytes / 1024 / 1024),
    recommendedAspect: '16:9',
  });
});

router.get('/tags/lookup', requireAuth, canWrite, async (req, res) => {
  try {
    const tags = await blogTagService.lookupTags(req.db, req.query.q);
    res.json({ tags });
  } catch (err) {
    console.error('tag lookup', err.message);
    res.status(500).json({ error: 'Lookup failed' });
  }
});

router.post('/tags/quick', requireAuth, canWrite, verifyCsrfPost, async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name required' });
  try {
    const id = await blogTagService.createTag(req.db, name);
    const tags = await blogTagService.lookupTags(req.db, name, { limit: 1 });
    const tag = tags[0] || { id, name, slug: name };
    res.json({ tag });
  } catch (err) {
    const code = err.code === 'VALIDATION' ? 400 : 500;
    res.status(code).json({ error: err.message || 'Could not create tag' });
  }
});

router.post('/autosave', requireAuth, canWrite, requireBlogNewPost, autosaveRateLimit, verifyCsrfPost, async (req, res) => {
  if (!autosaveEnabled()) return res.status(404).json({ error: 'Autosave disabled' });
  try {
    const fields = autosavePayloadToPostFields(req.body);
    const id = await blogRepository.createPost(req.db, fields, req.session.admin.id);
    await blogTagService.syncPostTags(req.db, id, req.body.tags).catch(() => {});
    res.json({ ok: true, postId: id });
  } catch (err) {
    console.error('autosave create', err.message);
    res.status(err.code === 'DUPLICATE_SLUG' ? 409 : 500).json({ error: err.message || 'Autosave failed' });
  }
});

router.patch('/:id/autosave', requireAuth, canWrite, autosaveRateLimit, verifyCsrfPost, async (req, res) => {
  if (!autosaveEnabled()) return res.status(404).json({ error: 'Autosave disabled' });
  const id = parseInt(req.params.id, 10);
  try {
    const existing = await blogRepository.getPostById(req.db, id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const fields = autosavePayloadToPostFields(req.body);
    if (existing.status === 'published') {
      delete fields.slug;
    }
    await blogRepository.updatePost(req.db, id, fields, { allowPublish: false });
    await blogTagService.syncPostTags(req.db, id, req.body.tags).catch(() => {});
    res.json({ ok: true, postId: id });
  } catch (err) {
    console.error('autosave update', err.message);
    res.status(err.code === 'DUPLICATE_SLUG' ? 409 : 500).json({ error: err.message || 'Autosave failed' });
  }
});

router.post(
  '/:id/content-image',
  requireAuth,
  canWrite,
  uploadFeaturedMemory.single('image'),
  verifyCsrfPost,
  async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!req.file) return res.status(400).json({ error: 'Image file required' });
    const post = await blogRepository.getPostById(req.db, id);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    try {
      const processed = await blogFeaturedImage.processAndStore({
        buffer: req.file.buffer,
        mimetype: req.file.mimetype,
        originalname: req.file.originalname,
        postId: id,
      });
      const alt = String(req.body.alt || '').trim().slice(0, 255);
      res.json({ ok: true, url: processed.featured_image, alt });
    } catch (err) {
      console.error('content image', err.message);
      res.status(400).json({ error: err.message || 'Upload failed' });
    }
  }
);

router.get('/:id/preview', requireAuth, canWrite, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const post = await blogRepository.getPostById(req.db, id);
    if (!post || post.deleted_at) {
      req.flash('error', 'Post not found');
      return res.redirect('/admin/blog');
    }

    const base = previewSiteBase();
    const seoMeta = buildArticleSeoMeta({ post, base });
    const rawHtml = post.content_html || '';
    const safeHtml = sanitizePublicHtml(rawHtml);
    const { html: contentWithIds, toc } = injectHeadingIds(safeHtml);
    const responsiveImage = post.featured_image
      ? buildResponsiveImage({
          featured: post.featured_image,
          variants: post.featured_image_variants,
          siteBase: base,
        })
      : null;

    const related = await blogPublic.listRelatedPublic(req.db, post.id, post.category_id, 3).catch(() => []);
    const jsonLdGraph = buildArticleGraph({
      post,
      siteBaseUrl: base || blogAiConfig.siteBaseUrl,
      defaultAuthor: blogAiConfig.defaultAuthor,
    });
    const contentJson = parseContentJson(post.content_json);
    const internalLinks = await resolveInternalSuggestions(
      req.db,
      contentJson.internal_link_suggestions
    );
    let faqs = [];
    if (Array.isArray(contentJson.faqs) && contentJson.faqs.length) {
      faqs = contentJson.faqs.filter((f) => (f.question || f.q) && (f.answer || f.a));
    }

    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.set('Cache-Control', 'no-store');
    res.render('blog-single', {
      layout: false,
      post: {
        ...post,
        content_html: contentWithIds,
        responsiveImage,
      },
      toc,
      related,
      internalLinks,
      faqs,
      canonical: seoMeta.canonical,
      shareUrl: seoMeta.canonical,
      jsonLdGraph,
      seoMeta,
      siteName: siteSeoConfig.siteName,
      showUpdated: false,
      pageMetaTitle: seoMeta.htmlTitle,
      pageMetaDescription: seoMeta.metaDescription,
      pageMetaKeywords: seoMeta.metaKeywords,
      pageOgImage: seoMeta.ogImage,
      pageRobots: 'noindex,nofollow',
      isAdminPreview: true,
    });
  } catch (err) {
    console.error('blog preview', err.message);
    req.flash('error', 'Preview failed');
    res.redirect(`/admin/blog/${id}/edit`);
  }
});

router.get('/import', requireAuth, canWrite, requireBlogImportCsv, (req, res) => {
  res.render('admin/blog-import', { title: 'Import Blog Posts' });
});

router.get('/ai', requireAuth, canWrite, requireBlogAi, async (req, res) => {
  try {
    const jobs = await blogAiService.listRecentJobs(req.db, 30);
    const queued = await blogAiService.countQueued(req.db);
    const { rows } = await blogRepository.listPosts(req.db, {
      q: '',
      status: 'all',
      page: 1,
      limit: 200,
      sort: 'updated_at',
      dir: 'desc',
    });
    res.render('admin/blog-ai', {
      title: 'AI Blog Tools',
      jobs,
      queued,
      posts: rows,
      openaiConfigured: !!process.env.OPENAI_API_KEY,
      importDir: blogAiConfig.importDir,
      model: blogAiConfig.model,
    });
  } catch (err) {
    console.error('admin blog ai', err.message);
    req.flash('error', 'Could not load AI tools.');
    res.redirect('/admin/blog');
  }
});

router.get('/:id/ai/preview', requireAuth, canWrite, requireBlogAi, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const post = await blogRepository.getPostById(req.db, id);
  if (!post) {
    req.flash('error', 'Post not found');
    return res.redirect('/admin/blog');
  }
  let contentJson = {};
  try {
    contentJson = post.content_json ? JSON.parse(post.content_json) : {};
  } catch {
    contentJson = {};
  }
  const revisions = await listRevisions(req.db, id, 10);
  const preview = req.session.blogAiPreview?.[id] || null;
  res.render('admin/blog-ai-preview', {
    title: 'AI Preview',
    post,
    contentJson,
    revisions,
    preview,
  });
});

router.post('/:id/ai/generate', requireAuth, canWrite, requireBlogAi, aiRateLimit, verifyCsrfPost, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const mode = ['full', 'content', 'metadata'].includes(req.body.mode) ? req.body.mode : 'full';
  const previewOnly = req.body.preview_only === '1';

  try {
    if (!process.env.OPENAI_API_KEY) {
      req.flash('error', 'OPENAI_API_KEY is not configured.');
      return res.redirect(`/admin/blog/${id}/ai/preview`);
    }
    const out = await blogArticleAi.rewriteExistingPost(req.db, id, {
      mode,
      adminId: req.session.admin.id,
      previewOnly,
    });
    if (previewOnly) {
      if (!req.session.blogAiPreview) req.session.blogAiPreview = {};
      req.session.blogAiPreview[id] = out.preview;
      req.flash('success', `AI preview generated (${mode}). Review before applying.`);
      return res.redirect(`/admin/blog/${id}/ai/preview`);
    }
    req.flash('success', `AI ${mode} rewrite saved as review (not published).`);
    delete req.session.blogAiPreview?.[id];
    return res.redirect(`/admin/blog/${id}/edit`);
  } catch (err) {
    console.error('ai generate', err.message);
    req.flash('error', err.code === 'AI_VALIDATION_FAILED' ? 'AI output failed validation.' : 'AI request failed.');
    return res.redirect(`/admin/blog/${id}/ai/preview`);
  }
});

router.post('/:id/ai/apply-preview', requireAuth, canWrite, requireBlogAi, verifyCsrfPost, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const preview = req.session.blogAiPreview?.[id];
  if (!preview) {
    req.flash('error', 'No preview in session. Generate preview first.');
    return res.redirect(`/admin/blog/${id}/ai/preview`);
  }
  try {
    const post = await blogRepository.getPostById(req.db, id);
    const { extractAllowedUrls } = require('../../services/ai/sourceSanitizer');
    const { applyArticleToPost } = require('../../services/ai/articleMapper');
    const allowedUrls = extractAllowedUrls(post?.content_html || '');
    await applyArticleToPost(req.db, id, preview, {
      mode: 'full',
      allowedUrls,
      adminId: req.session.admin.id,
      aiModel: blogAiConfig.model,
      authorName: post?.author_name || blogAiConfig.defaultAuthor,
    });
    delete req.session.blogAiPreview[id];
    req.flash('success', 'Preview applied to draft/review.');
    res.redirect(`/admin/blog/${id}/edit`);
  } catch (err) {
    console.error('apply preview', err.message);
    req.flash('error', 'Could not apply preview.');
    res.redirect(`/admin/blog/${id}/ai/preview`);
  }
});

router.post('/ai/folder', requireAuth, canWrite, requireBlogAi, verifyCsrfPost, async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      req.flash('error', 'OPENAI_API_KEY is not configured.');
      return res.redirect('/admin/blog/ai');
    }
    const subdir = String(req.body.subdir || '.').trim();
    const limit = Math.min(parseInt(req.body.limit, 10) || 5, 25);
    const result = await blogArticleAi.processImportFolder(req.db, {
      adminId: req.session.admin.id,
      subdir,
      limit,
    });
    req.flash(
      'success',
      `Folder job ${result.jobKey}: ${result.completed} ok, ${result.failed} failed, ${result.skipped} skipped.`
    );
  } catch (err) {
    console.error('folder import', err.message);
    req.flash('error', err.message || 'Folder processing failed');
  }
  res.redirect('/admin/blog/ai');
});

router.post(
  '/:id/featured-image',
  requireAuth,
  canWrite,
  uploadFeaturedMemory.single('featured_image'),
  verifyCsrfPost,
  async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!req.file) {
      req.flash('error', 'Choose an image file to upload.');
      return res.redirect(`/admin/blog/${id}/edit`);
    }
    try {
      const processed = await blogFeaturedImage.processAndStore({
        buffer: req.file.buffer,
        mimetype: req.file.mimetype,
        originalname: req.file.originalname,
        postId: id,
      });
      const alt = req.body.featured_image_alt;
      const result = await blogFeaturedImage.applyFeaturedImage(req.db, id, processed, alt);
      const msg = result.aspectWarning
        ? `Thumbnail saved. Note: ${result.aspectWarning}`
        : 'Featured thumbnail uploaded.';
      req.flash('success', msg);
    } catch (err) {
      console.error('featured upload', err.message);
      flashFeaturedError(req, err);
    }
    res.redirect(`/admin/blog/${id}/edit`);
  }
);

router.post('/:id/featured-image/remove', requireAuth, canWrite, verifyCsrfPost, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    await blogFeaturedImage.removeFeaturedImage(req.db, id);
    req.flash('success', 'Featured thumbnail removed.');
  } catch (err) {
    console.error('featured remove', err.message);
    req.flash('error', 'Could not remove thumbnail.');
  }
  res.redirect(`/admin/blog/${id}/edit`);
});

router.post('/:id/featured-image/alt', requireAuth, canWrite, verifyCsrfPost, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const alt = String(req.body.featured_image_alt || '').trim().slice(0, 255);
  try {
    const post = await blogRepository.getPostById(req.db, id);
    if (!post) {
      req.flash('error', 'Post not found');
      return res.redirect('/admin/blog');
    }
  if (!post.featured_image) {
      req.flash('error', 'Upload a thumbnail before setting alt text.');
      return res.redirect(`/admin/blog/${id}/edit`);
    }
    await req.db.query(`UPDATE blog_posts SET featured_image_alt = :alt WHERE id = :id`, {
      id,
      alt: alt || null,
    });
    req.flash('success', 'Alt text saved.');
  } catch (err) {
    req.flash('error', 'Could not save alt text.');
  }
  res.redirect(`/admin/blog/${id}/edit`);
});

router.get('/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id < 1) {
    return res.redirect('/admin/blog');
  }
  if (!blogAdminConfig.postDetail) {
    const canEdit =
      req.session?.admin && ['super', 'manager'].includes(req.session.admin.role);
    if (canEdit) return res.redirect(`/admin/blog/${id}/edit`);
    return res.redirect('/admin/blog');
  }
  try {
    const post = await blogRepository.getPostById(req.db, id);
    if (!post) {
      req.flash('error', 'Post not found');
      return res.redirect('/admin/blog');
    }
    const returnQs = String(req.query.return || '').trim();
    return res.render('admin/blog-detail', {
      title: post.title,
      post,
      returnQs,
    });
  } catch (err) {
    console.error('admin blog detail', err.message);
    req.flash('error', 'Could not load post.');
    return res.redirect('/admin/blog');
  }
});

router.get('/:id/edit', requireAuth, canWrite, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const post = await blogRepository.getPostById(req.db, id);
  if (!post) {
    req.flash('error', 'Post not found');
    return res.redirect('/admin/blog');
  }
  const linkSuggestions = await recommendLinksForPost(req.db, id).catch(() => null);
  const categories = await blogCategoryService.listCategories(req.db).catch(() => []);
  const postTags = await blogTagService.getPostTags(req.db, id).catch(() => []);
  res.render('admin/blog-edit', {
    title: 'Edit Blog Post',
    post,
    mode: 'edit',
    categories,
    postTags,
    imageMaxMb: Math.round(blogMediaConfig.maxBytes / 1024 / 1024),
    recommendedAspect: '16:9',
    linkSuggestions,
  });
});

router.post('/import', requireAuth, canWrite, requireBlogImportCsv, verifyCsrfPost, async (req, res) => {
  const csvText = String(req.body.csv_text || '').trim();
  const updateExisting = req.body.update_existing === '1';

  if (!csvText) {
    req.flash('error', 'Paste CSV content or upload a file');
    return res.redirect('/admin/blog/import');
  }

  try {
    const result = await blogImportService.importCsv(req.db, csvText, {
      adminId: req.session.admin.id,
      updateExisting,
    });
    req.flash(
      'success',
      `Import complete: ${result.imported} imported, ${result.skipped} skipped, ${result.failed} failed (batch ${result.batchKey}).`
    );
  } catch (err) {
    console.error('blog import', err.message);
    req.flash('error', 'Import failed. Check CSV format and migration status.');
  }
  res.redirect('/admin/blog/import');
});

router.post('/ai/queue', requireAuth, canWrite, requireBlogAi, verifyCsrfPost, async (req, res) => {
  const postIds = parsePostIds(req.body.post_ids);
  const jobType = req.body.job_type;

  if (!postIds.length) {
    req.flash('error', 'Select at least one post');
    return res.redirect('/admin/blog/ai');
  }

  const map = {
    rewrite: 'rewrite_bulk',
    seo: 'seo_bulk',
    content: 'article_content',
    metadata: 'article_metadata',
  };
  const type = map[jobType];
  if (!type) {
    req.flash('error', 'Invalid job type');
    return res.redirect('/admin/blog/ai');
  }

  try {
    if (!process.env.OPENAI_API_KEY) {
      req.flash('error', 'OPENAI_API_KEY is not configured on the server.');
      return res.redirect('/admin/blog/ai');
    }
    const { batchId, count } = await blogAiService.queueJobs(req.db, postIds, type, req.session.admin.id);
    req.flash('success', `Queued ${count} job(s). Batch: ${batchId}. Run processing next.`);
  } catch (err) {
    console.error('queue ai', err.message);
    req.flash('error', 'Failed to queue AI jobs');
  }
  res.redirect('/admin/blog/ai');
});

router.post('/ai/run', requireAuth, canWrite, requireBlogAi, verifyCsrfPost, async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      req.flash('error', 'OPENAI_API_KEY is not configured on the server.');
      return res.redirect('/admin/blog/ai');
    }
    const limit = Math.min(parseInt(req.body.limit, 10) || 5, 10);
    const result = await blogAiService.processQueuedJobs(req.db, limit);
    const msg = `Processed: ${result.completed} completed, ${result.failed} failed.`;
    req.flash(result.failed ? 'error' : 'success', msg);
  } catch (err) {
    console.error('run ai', err.message);
    req.flash('error', 'AI job processing failed');
  }
  res.redirect('/admin/blog/ai');
});

router.post('/', requireAuth, canWrite, requireBlogNewPost, uploadFeaturedMemory.single('featured_image'), verifyCsrfPost, async (req, res) => {
  const title = String(req.body.title || '').trim();
  if (!title) {
    req.flash('error', 'Title is required');
    return res.redirect('/admin/blog/new');
  }

  try {
    const id = await blogRepository.createPost(
      req.db,
      {
        title,
        slug: req.body.slug,
        excerpt: req.body.excerpt,
        content_html: req.body.content_html,
        status: req.body.status === 'review' ? 'review' : 'draft',
        featured_image: null,
        featured_image_alt: String(req.body.featured_image_alt || '').trim().slice(0, 255) || null,
        meta_title: req.body.meta_title,
        meta_description: req.body.meta_description,
        meta_keywords: req.body.meta_keywords,
        canonical_url: req.body.canonical_url,
        og_title: req.body.og_title,
        og_description: req.body.og_description,
        robots_directive: req.body.robots || req.body.robots_directive,
        source_url: req.body.source_url,
        category_id: parseCategoryId(req.body),
      },
      req.session.admin.id
    );
    await blogTagService.syncPostTags(req.db, id, req.body.tags).catch(() => {});
    let thumbMsg = '';
    if (req.file) {
      try {
        const result = await applyFeaturedUploadFromRequest(req, id);
        if (result?.aspectWarning) thumbMsg = ` Thumbnail: ${result.aspectWarning}`;
        else thumbMsg = ' Thumbnail uploaded.';
      } catch (imgErr) {
        console.error('create blog thumb', imgErr.message);
        flashFeaturedError(req, imgErr);
        return res.redirect(`/admin/blog/${id}/edit`);
      }
    }
    const wantPublish =
      req.body.publish_after_save === '1' ||
      req.body.publish_after_save === 'true' ||
      req.body.publish_after_save === 1;
    if (wantPublish) {
      await blogRepository.publishPost(req.db, id);
      req.flash('success', `Post published.${thumbMsg}`);
    } else {
      req.flash('success', `Draft saved.${thumbMsg}`);
    }
    res.redirect(`/admin/blog/${id}/edit`);
  } catch (err) {
    console.error('create blog', err.message);
    req.flash('error', err.code === 'DUPLICATE_SLUG' ? 'Slug already in use' : 'Failed to create post');
    res.redirect('/admin/blog/new');
  }
});

router.post('/:id', requireAuth, canWrite, uploadFeaturedMemory.single('featured_image'), verifyCsrfPost, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const title = String(req.body.title || '').trim();
  if (!title) {
    req.flash('error', 'Title is required');
    return res.redirect(`/admin/blog/${id}/edit`);
  }

  const wantPublish =
    req.body.publish_after_save === '1' ||
    req.body.publish_after_save === 'true' ||
    req.body.publish_after_save === 1;

  try {
    const existing = await blogRepository.getPostById(req.db, id);
    if (!existing) {
      req.flash('error', 'Post not found');
      return res.redirect('/admin/blog');
    }

    const bodyStatus = String(req.body.status || '').trim();
    let status;
    if (wantPublish) {
      status = 'published';
    } else if (['draft', 'review', 'scheduled', 'archived'].includes(bodyStatus)) {
      status = bodyStatus;
    } else if (existing.status === 'published' || bodyStatus === 'published') {
      status = 'published';
    } else {
      status = existing.status || 'draft';
    }

    const allowPublish = wantPublish || status === 'published';

    await blogRepository.updatePost(
      req.db,
      id,
      {
        title,
        slug: req.body.slug,
        excerpt: req.body.excerpt,
        content_html: req.body.content_html,
        status,
        featured_image_alt: String(req.body.featured_image_alt || '').trim().slice(0, 255) || null,
        meta_title: req.body.meta_title,
        meta_description: req.body.meta_description,
        meta_keywords: req.body.meta_keywords,
        canonical_url: req.body.canonical_url,
        og_title: req.body.og_title,
        og_description: req.body.og_description,
        robots_directive: req.body.robots || req.body.robots_directive,
        scheduled_at: parseScheduledAt(req.body.scheduled_at),
        source_url: req.body.source_url,
        category_id: parseCategoryId(req.body),
      },
      { allowPublish }
    );
    await blogTagService.syncPostTags(req.db, id, req.body.tags).catch(() => {});

    let extra = '';
    if (req.file) {
      try {
        const result = await applyFeaturedUploadFromRequest(req, id);
        extra = result?.aspectWarning ? ` Thumbnail: ${result.aspectWarning}` : ' Thumbnail updated.';
      } catch (imgErr) {
        console.error('update blog thumb', imgErr.message);
        flashFeaturedError(req, imgErr);
        return res.redirect(`/admin/blog/${id}/edit`);
      }
    }

    if (wantPublish) {
      await blogRepository.publishPost(req.db, id);
    }

    req.flash(
      'success',
      wantPublish ? `Post saved and published.${extra}` : `Post saved.${extra}`
    );
    res.redirect(`/admin/blog/${id}/edit`);
  } catch (err) {
    console.error('update blog', err.message);
    req.flash('error', err.code === 'DUPLICATE_SLUG' ? 'Slug already in use' : 'Failed to update post');
    res.redirect(`/admin/blog/${id}/edit`);
  }
});

router.post('/:id/unpublish', requireAuth, canWrite, verifyCsrfPost, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const ok = await blogRepository.unpublishPost(req.db, id);
    if (ok) {
      await logBlogAudit(req.db, {
        adminId: req.session.admin.id,
        action: 'post_unpublish',
        entityType: 'blog_post',
        entityId: id,
      });
    }
    req.flash(ok ? 'success' : 'error', ok ? 'Post unpublished (draft).' : 'Post not found.');
  } catch (err) {
    req.flash('error', 'Unpublish failed.');
  }
  res.redirect(`/admin/blog/${id}/edit`);
});

router.post('/:id/publish', requireAuth, canWrite, verifyCsrfPost, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const ok = await blogRepository.publishPost(req.db, id);
    req.flash(ok ? 'success' : 'error', ok ? 'Post published.' : 'Post not found.');
  } catch (err) {
    console.error('publish blog', err.message);
    req.flash('error', 'Publish failed');
  }
  res.redirect(`/admin/blog/${id}/edit`);
});

router.post('/:id/delete', requireAuth, canWrite, requireBlogTrash, verifyCsrfPost, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const ret = String(req.body.return || '').trim();
  let redirect = '/admin/blog';
  if (ret === 'list') redirect = '/admin/blog';
  else if (ret && ret !== 'detail') redirect = `/admin/blog?${ret}`;
  try {
    const ok = await blogRepository.deletePost(req.db, id);
    if (ok) {
      await logBlogAudit(req.db, {
        adminId: req.session.admin.id,
        action: 'post_trash',
        entityType: 'blog_post',
        entityId: id,
      });
      redirect = '/admin/blog/trash';
    }
    req.flash(ok ? 'success' : 'error', ok ? 'Post moved to trash.' : 'Post not found.');
  } catch (err) {
    console.error('delete blog', err.message);
    req.flash('error', 'Move to trash failed');
  }
  res.redirect(redirect);
});

module.exports = router;
'use strict';

const { parseArticleOutput } = require('./articleOutputSchema');
const {
  filterExternalUrls,
  stripInternalUrlClaims,
} = require('./sourceSanitizer');
const { blogAiConfig } = require('../../config/blogAiConfig');
const blogRepository = require('../blogRepository');
const slugify = require('../../utils/slugify');
const { buildArticleGraph } = require('../../utils/jsonLdBlog');

async function resolveCategoryId(db, name) {
  if (!name || !String(name).trim()) return null;
  const slug = slugify(name);
  const [rows] = await db.query(
    `SELECT id FROM blog_categories WHERE slug = :slug LIMIT 1`,
    { slug }
  );
  if (rows[0]) return rows[0].id;
  const [ins] = await db.query(
    `INSERT INTO blog_categories (name, slug, description) VALUES (:name, :slug, NULL)`,
    { name: String(name).trim().slice(0, 150), slug }
  );
  return ins.insertId;
}

async function syncTags(db, postId, tagNames) {
  if (!postId || !tagNames?.length) return;
  await db.query(`DELETE FROM blog_post_tags WHERE post_id = :post_id`, { post_id: postId });
  for (const raw of tagNames) {
    const name = String(raw || '').trim().slice(0, 100);
    if (!name) continue;
    const slug = slugify(name);
    let tagId;
    const [found] = await db.query(`SELECT id FROM blog_tags WHERE slug = :slug LIMIT 1`, { slug });
    if (found[0]) tagId = found[0].id;
    else {
      const [ins] = await db.query(
        `INSERT INTO blog_tags (name, slug) VALUES (:name, :slug)`,
        { name, slug }
      );
      tagId = ins.insertId;
    }
    await db.query(
      `INSERT IGNORE INTO blog_post_tags (post_id, tag_id) VALUES (:post_id, :tag_id)`,
      { post_id: postId, tag_id: tagId }
    );
  }
}

function computeSeoWarnings(post, aiWarnings) {
  const warnings = [...(aiWarnings || [])];
  if (!post.meta_title) warnings.push('Missing meta_title');
  if (!post.meta_description) warnings.push('Missing meta_description');
  if (!post.focus_keyword) warnings.push('Missing focus_keyword');
  if (post.meta_title && post.meta_title.length > 60) warnings.push('meta_title may be too long');
  if (post.meta_description && post.meta_description.length > 160) {
    warnings.push('meta_description may be too long');
  }
  return [...new Set(warnings)].slice(0, 30);
}

/**
 * Validate AI output again and map to trusted DB fields (never auto-publish).
 */
async function applyArticleToPost(db, postId, rawArticle, context = {}) {
  const {
    mode = 'full',
    allowedUrls = new Set(),
    adminId,
    authorName = blogAiConfig.defaultAuthor,
    aiModel,
    responseId,
    preserveSlug = false,
  } = context;

  const parsed = parseArticleOutput(rawArticle, mode);
  if (!parsed.success) {
    const err = new Error('AI output failed server validation');
    err.code = 'AI_VALIDATION_FAILED';
    err.detail = parsed.error.flatten();
    throw err;
  }

  const a = parsed.data;
  a.suggested_external_sources = filterExternalUrls(a.suggested_external_sources, allowedUrls);
  a.internal_link_suggestions = stripInternalUrlClaims(a.internal_link_suggestions);

  const existing = await blogRepository.getPostById(db, postId);
  if (!existing) {
    const err = new Error('Post not found');
    err.code = 'NOT_FOUND';
    throw err;
  }

  let slug = existing.slug;
  if (!preserveSlug && a.slug_suggestion) {
    slug = await blogRepository.uniqueSlug(db, slugify(a.slug_suggestion), postId);
  }

  const canonical = `${blogAiConfig.siteBaseUrl}/blog/${slug}`;
  const categoryId = a.suggested_category
    ? await resolveCategoryId(db, a.suggested_category)
    : existing.category_id;

  const contentBundle = {
    faqs: a.faqs,
    key_takeaways: a.key_takeaways,
    internal_link_suggestions: a.internal_link_suggestions,
    suggested_external_sources: a.suggested_external_sources,
    ai_response_id: responseId || null,
    structured_data: null,
    source_snapshot_preserved_at: context.preservedAt || null,
  };

  const patch = {
    title: a.title || existing.title,
    slug,
    subtitle: a.subtitle,
    excerpt: a.excerpt,
    meta_title: a.meta_title,
    meta_description: a.meta_description,
    meta_abstract: a.meta_abstract,
    meta_keywords: a.meta_keywords,
    focus_keyword: a.focus_keyword,
    secondary_keywords: a.secondary_keywords,
    search_intent: a.search_intent,
    featured_image_alt: a.suggested_image_alt || existing.featured_image_alt,
    og_title: a.og_title,
    og_description: a.og_description,
    twitter_title: a.twitter_title,
    twitter_description: a.twitter_description,
    canonical_url: canonical,
    robots_directive: 'index,follow',
    category_id: categoryId,
    author_name: authorName,
    status: 'review',
    ai_generated: 1,
    ai_model: aiModel,
    ai_review_status: 'pending',
    seo_warnings: computeSeoWarnings(
      {
        meta_title: a.meta_title,
        meta_description: a.meta_description,
        focus_keyword: a.focus_keyword,
      },
      a.review_warnings
    ),
    allow_indexing: 1,
  };

  if (mode !== 'metadata' && a.content_html) {
    patch.content_html = a.content_html;
  }

  await blogRepository.updatePost(db, postId, patch, { allowPublish: false });

  const updated = await blogRepository.getPostById(db, postId);
  contentBundle.structured_data = buildArticleGraph({
    post: updated,
    siteBaseUrl: blogAiConfig.siteBaseUrl,
    defaultAuthor: authorName,
  });

  await db.query(
    `UPDATE blog_posts SET content_json = :json WHERE id = :id`,
    { id: postId, json: JSON.stringify(contentBundle) }
  );

  if (a.suggested_tags?.length) await syncTags(db, postId, a.suggested_tags);

  return {
    postId,
    slug,
    validation: { ok: true },
    review_warnings: patch.seo_warnings,
    confidence_notes: a.confidence_notes,
  };
}

module.exports = {
  applyArticleToPost,
  resolveCategoryId,
  syncTags,
  computeSeoWarnings,
};
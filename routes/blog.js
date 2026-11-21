'use strict';

const express = require('express');
const blogRepository = require('../services/blogRepository');
const blogPublic = require('../services/blogPublicService');
const { buildResponsiveImage, buildArticleHeroImage } = require('../utils/blogImageView');
const { sanitizePublicHtml } = require('../utils/sanitizePublicHtml');
const { injectHeadingIds } = require('../utils/blogToc');
const { buildArticleGraph, parseContentJson } = require('../utils/jsonLdBlog');
const { buildListUrl } = require('../utils/blogPagination');
const { blogAiConfig } = require('../config/blogAiConfig');
const { buildListSeoMeta, buildArticleSeoMeta } = require('../services/blogSeoMeta');
const { siteSeoConfig } = require('../config/siteSeoConfig');
const { resolveInternalSuggestions } = require('../services/blogInternalLinksService');

const router = express.Router();

const CACHE_LIST = 'public, max-age=60, stale-while-revalidate=120';
const CACHE_ARTICLE = 'public, max-age=300, stale-while-revalidate=600';

function siteBase() {
  return (
    process.env.SITE_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    ''
  ).replace(/\/$/, '');
}

function mapListPosts(rows, base) {
  return (rows || []).map((p) => ({
    ...p,
    responsiveImage: p.featured_image
      ? buildResponsiveImage({
          featured: p.featured_image,
          variants: p.featured_image_variants,
          siteBase: base,
        })
      : null,
  }));
}

function formatShareUrl(path) {
  const base = siteBase();
  return base ? `${base}${path.startsWith('/') ? path : `/${path}`}` : path;
}

async function renderBlogList(req, res, { categorySlug, category, pageTitle, pageDesc }) {
  const q = String(req.query.q || '').trim().slice(0, 120);
  const pageRaw = req.query.page;
  const filterSlug =
    categorySlug || String(req.query.category || '').trim() || undefined;

  try {
    let cat = category;
    if (!cat && filterSlug) {
      cat = await blogPublic.getCategoryBySlug(req.db, filterSlug);
      if (!cat) {
        return res.status(404).render('404', { title: 'Not Found', layout: false });
      }
    }

    const { rows, pagination, invalidPage } = await blogPublic.listPublishedPublic(req.db, {
      pageRaw,
      q: q || undefined,
      categorySlug: filterSlug,
    });

    if (invalidPage) {
      return res.status(404).render('404', { title: 'Not Found', layout: false });
    }

    const base = siteBase();
    const posts = mapListPosts(rows, base);
    const categories = await blogPublic.listCategoriesWithCounts(req.db);
    const activeCat = filterSlug || '';
    const listBase = activeCat ? `/blog/category/${activeCat}` : '/blog';

    const seoMeta = buildListSeoMeta({
      base,
      listBase,
      page: pagination.page,
      q,
      categoryName: cat?.name,
    });

    res.set('Cache-Control', CACHE_LIST);
    res.render('blog-list', {
      layout: false,
      posts,
      pagination,
      categories,
      searchQuery: q,
      activeCategory: activeCat,
      category: cat,
      listBase,
      seoMeta,
      siteName: siteSeoConfig.siteName,
      canonical: seoMeta.canonical,
      buildListUrl: (page) =>
        buildListUrl({
          basePath: listBase,
          page,
          q,
          categorySlug: categorySlug || undefined,
        }),
      pageMetaTitle: seoMeta.htmlTitle,
      pageMetaDescription: seoMeta.metaDescription,
      pageRobots: seoMeta.robots,
    });
  } catch (err) {
    console.error('blog list error', err.message);
    res.status(500).render('500', { title: 'Server Error', layout: false, error: err });
  }
}

router.get('/blog', (req, res) => renderBlogList(req, res, {}));

router.get('/blog/category/:slug', async (req, res) => {
  const slug = String(req.params.slug || '').trim();
  if (!slug) return res.redirect('/blog');
  const category = await blogPublic.getCategoryBySlug(req.db, slug);
  if (!category) {
    return res.status(404).render('404', { title: 'Not Found', layout: false });
  }
  return renderBlogList(req, res, {
    categorySlug: slug,
    category,
    pageTitle: `${category.name} | Blog | Anannt Urjaa`,
    pageDesc: category.description || `Articles in ${category.name}.`,
  });
});

router.get('/blog/:slug', async (req, res) => {
  const slug = String(req.params.slug || '').trim();
  if (!slug || slug === 'category') return res.redirect('/blog');

  try {
    let post = await blogPublic.getPublishedPostBySlug(req.db, slug);
    if (!post) {
      const redir = await blogRepository.getRedirectTarget(req.db, slug);
      if (redir) return res.redirect(301, `/blog/${redir.slug}`);
      return res.status(404).render('404', { title: 'Not Found', layout: false });
    }

    const base = siteBase();
    const seoMeta = buildArticleSeoMeta({ post, base });
    const canonical = seoMeta.canonical;
    const shareUrl = formatShareUrl(`/blog/${post.slug}`);

    const rawHtml = post.content_html || '';
    const safeHtml = sanitizePublicHtml(rawHtml);
    const { html: contentWithIds, toc } = injectHeadingIds(safeHtml);

    const heroImage = buildArticleHeroImage({
      featured: post.featured_image,
      variants: post.featured_image_variants,
      ogImage: post.og_image,
      contentHtml: safeHtml,
      siteBase: base,
    });

    const related = mapListPosts(
      await blogPublic.listRelatedPublic(req.db, post.id, post.category_id, 3),
      base
    );

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

    const showUpdated =
      post.updated_at &&
      post.published_at &&
      new Date(post.updated_at).getTime() > new Date(post.published_at).getTime() + 60000;

    res.set('Cache-Control', CACHE_ARTICLE);
    res.render('blog-single', {
      layout: false,
      post: {
        ...post,
        content_html: contentWithIds,
        heroImage,
      },
      toc,
      related,
      internalLinks,
      faqs,
      canonical,
      shareUrl,
      jsonLdGraph,
      seoMeta,
      siteName: siteSeoConfig.siteName,
      showUpdated,
      pageMetaTitle: seoMeta.htmlTitle,
      pageMetaDescription: seoMeta.metaDescription,
      pageMetaKeywords: seoMeta.metaKeywords,
      pageOgImage: seoMeta.ogImage,
      pageRobots: seoMeta.robots,
    });
  } catch (err) {
    console.error('blog single error', err.message);
    res.status(500).render('500', { title: 'Server Error', layout: false, error: err });
  }
});

module.exports = router;
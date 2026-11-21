'use strict';

const { siteSeoConfig } = require('../config/siteSeoConfig');
const { absoluteUploadUrl } = require('../utils/blogImageView');
const { buildListUrl } = require('../utils/blogPagination');

function absoluteUrl(base, path) {
  const b = String(base || '').replace(/\/$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return b ? `${b}${p}` : p;
}

/**
 * Canonical strategy: one preferred URL per article; list pages self-canonical per page (not all to /blog).
 */
function buildListSeoMeta({ base, listBase, page, q, categoryName }) {
  const hasSearch = !!(q && q.trim());
  const pageNum = Math.max(1, parseInt(page, 10) || 1);

  let canonicalPath = listBase || '/blog';
  if (pageNum > 1) {
    canonicalPath = buildListUrl({ basePath: listBase || '/blog', page: pageNum, q: undefined, categorySlug: undefined });
  }

  const title =
    pageNum > 1
      ? `Blog — Page ${pageNum} | ${siteSeoConfig.siteName}`
      : categoryName
        ? `${categoryName} | Blog | ${siteSeoConfig.siteName}`
        : `Blog | ${siteSeoConfig.siteName}`;

  const description = categoryName
    ? `Browse published articles in ${categoryName} from ${siteSeoConfig.siteName}.`
    : siteSeoConfig.defaultDescription;

  return {
    htmlTitle: title.slice(0, 70),
    metaDescription: description.slice(0, 160),
    robots: hasSearch ? 'noindex,follow' : 'index,follow',
    canonical: absoluteUrl(base, canonicalPath),
    ogType: 'website',
    ogTitle: title.slice(0, 100),
    ogDescription: description.slice(0, 200),
    twitterCard: 'summary',
    lang: siteSeoConfig.siteLocale.split('-')[0] || 'en',
    locale: siteSeoConfig.siteLocale,
  };
}

function buildArticleSeoMeta({ post, base }) {
  const slugPath = `/blog/${post.slug}`;
  const canonical =
    post.canonical_url && /^https?:\/\//i.test(post.canonical_url)
      ? post.canonical_url
      : absoluteUrl(base, slugPath);

  const htmlTitle = (post.meta_title || post.title || siteSeoConfig.siteName).slice(0, 70);
  const metaDescription = (
    post.meta_description ||
    post.excerpt ||
    post.meta_abstract ||
    ''
  ).slice(0, 160);

  const robots = String(post.robots_directive || post.robots || 'index,follow').slice(0, 80);
  const ogTitle = (post.og_title || post.meta_title || post.title || '').slice(0, 100);
  const ogDescription = (post.og_description || post.meta_description || post.excerpt || '').slice(0, 200);

  let ogImage;
  if (post.featured_image) {
    ogImage = absoluteUploadUrl(base, post.og_image || post.featured_image);
  }

  const twitterTitle = (post.twitter_title || ogTitle).slice(0, 100);
  const twitterDescription = (post.twitter_description || ogDescription).slice(0, 200);

  const hasImage = Boolean(ogImage);

  return {
    htmlTitle,
    metaDescription,
    robots,
    canonical,
    ogType: 'article',
    ogTitle,
    ogDescription,
    ogImage,
    twitterCard: hasImage ? 'summary_large_image' : 'summary',
    twitterTitle,
    twitterDescription,
    twitterSite: siteSeoConfig.twitterSite || undefined,
    articlePublished: post.published_at,
    articleModified: post.updated_at,
    articleAuthor: post.author_name || undefined,
    lang: siteSeoConfig.siteLocale.split('-')[0] || 'en',
    locale: siteSeoConfig.siteLocale,
    metaKeywords: (post.meta_keywords || post.focus_keyword || '').slice(0, 500),
  };
}

module.exports = {
  buildListSeoMeta,
  buildArticleSeoMeta,
  absoluteUrl,
};
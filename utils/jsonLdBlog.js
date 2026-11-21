'use strict';

const { siteSeoConfig } = require('../config/siteSeoConfig');
const { absoluteUploadUrl } = require('./blogImageView');
const { toIsoDate } = require('./metaEscape');

function siteId(base) {
  return `${String(base).replace(/\/$/, '')}/#website`;
}

function orgId(base) {
  return `${String(base).replace(/\/$/, '')}/#organization`;
}

function buildOrganization(base) {
  const url = String(base || '').replace(/\/$/, '') || undefined;
  const logo = absoluteUploadUrl(base, siteSeoConfig.logoUrl);
  return {
    '@type': 'Organization',
    '@id': orgId(base),
    name: siteSeoConfig.organizationName,
    url,
    logo: logo ? { '@type': 'ImageObject', url: logo } : undefined,
  };
}

function buildWebSite(base) {
  const url = String(base || '').replace(/\/$/, '');
  return {
    '@type': 'WebSite',
    '@id': siteId(base),
    url,
    name: siteSeoConfig.siteName,
    publisher: { '@id': orgId(base) },
    inLanguage: siteSeoConfig.siteLocale,
  };
}

function buildBreadcrumbList({ base, items }) {
  const list = (items || []).filter((i) => i.name && i.url);
  if (!list.length) return null;
  return {
    '@type': 'BreadcrumbList',
    itemListElement: list.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

function buildBlogPosting({ post, base, defaultAuthor }) {
  const url =
    post.canonical_url && /^https?:\/\//i.test(post.canonical_url)
      ? post.canonical_url
      : `${String(base).replace(/\/$/, '')}/blog/${post.slug}`;
  const authorName = post.author_name || defaultAuthor || 'Editorial Team';

  const node = {
    '@type': 'BlogPosting',
    '@id': `${url}#article`,
    mainEntityOfPage: { '@id': `${url}#webpage` },
    headline: (post.meta_title || post.title || '').slice(0, 110),
    description: (post.meta_description || post.excerpt || post.meta_abstract || '').slice(0, 500),
    url,
    inLanguage: siteSeoConfig.siteLocale,
    author: { '@type': 'Person', name: authorName },
    publisher: { '@id': orgId(base) },
    datePublished: toIsoDate(post.published_at),
    dateModified: toIsoDate(post.updated_at || post.published_at),
    isPartOf: { '@id': siteId(base) },
  };

  if (post.featured_image) {
    node.image = [absoluteUploadUrl(base, post.featured_image)];
  }

  if (post.focus_keyword) node.keywords = String(post.focus_keyword).slice(0, 120);
  else if (post.meta_keywords) node.keywords = String(post.meta_keywords).slice(0, 200);

  return node;
}

function buildWebPage({ post, base }) {
  const url =
    post.canonical_url && /^https?:\/\//i.test(post.canonical_url)
      ? post.canonical_url
      : `${String(base).replace(/\/$/, '')}/blog/${post.slug}`;
  return {
    '@type': 'WebPage',
    '@id': `${url}#webpage`,
    url,
    name: (post.meta_title || post.title || '').slice(0, 110),
    description: (post.meta_description || post.excerpt || '').slice(0, 300),
    inLanguage: siteSeoConfig.siteLocale,
    isPartOf: { '@id': siteId(base) },
    about: { '@id': `${url}#article` },
  };
}

/**
 * FAQPage only when FAQs exist in stored JSON and each has question+answer text (no rich-result promises).
 */
function buildFaqPage(faqs) {
  const items = (faqs || [])
    .map((f) => ({
      q: String(f.question || f.q || '').trim(),
      a: String(f.answer || f.a || '').trim(),
    }))
    .filter((f) => f.q && f.a)
    .slice(0, 20);
  if (items.length < 1) return null;

  return {
    '@type': 'FAQPage',
    mainEntity: items.map((f) => ({
      '@type': 'Question',
      name: f.q.slice(0, 300),
      acceptedAnswer: {
        '@type': 'Answer',
        text: f.a.slice(0, 2000),
      },
    })),
  };
}

function parseContentJson(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function buildArticleGraph({ post, siteBaseUrl, defaultAuthor }) {
  const base = String(siteBaseUrl || '').replace(/\/$/, '');
  if (!base) return null;

  const contentJson = parseContentJson(post.content_json);
  const faqs = contentJson.faqs;

  const breadcrumbs = buildBreadcrumbList({
    base,
    items: [
      { name: 'Home', url: base },
      { name: 'Blog', url: `${base}/blog` },
      post.category_name && post.category_slug
        ? { name: post.category_name, url: `${base}/blog/category/${post.category_slug}` }
        : null,
      { name: post.title, url: `${base}/blog/${post.slug}` },
    ].filter(Boolean),
  });

  const graph = [
    buildOrganization(base),
    buildWebSite(base),
    buildWebPage({ post, base }),
    buildBlogPosting({ post, base, defaultAuthor }),
    breadcrumbs,
    buildFaqPage(faqs),
  ].filter(Boolean);

  return {
    '@context': 'https://schema.org',
    '@graph': graph,
  };
}

/** @deprecated use buildArticleGraph */
function buildBlogPostingJsonLd(opts) {
  const one = buildBlogPosting({ post: opts.post, base: opts.siteBaseUrl, defaultAuthor: opts.defaultAuthor });
  return { '@context': 'https://schema.org', ...one };
}

module.exports = {
  buildArticleGraph,
  buildBlogPostingJsonLd,
  buildBreadcrumbList,
  buildFaqPage,
  parseContentJson,
};
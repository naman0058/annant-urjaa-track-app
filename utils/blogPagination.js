'use strict';

const DEFAULT_LIMIT = 9;

function parsePositiveInt(raw, fallback) {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1) return fallback;
  return n;
}

function parseLimit() {
  return DEFAULT_LIMIT;
}

/**
 * @returns {{ page: number, limit: number, invalidPage: boolean, totalPages: number }}
 */
function resolvePagination({ pageRaw, total }) {
  const limit = parseLimit();
  const totalPages = Math.max(1, Math.ceil((Number(total) || 0) / limit));
  let page = parsePositiveInt(pageRaw, 1);
  let invalidPage = false;
  if (Number(total) > 0 && page > totalPages) {
    invalidPage = true;
    page = totalPages;
  }
  return { page, limit, invalidPage, totalPages, offset: (page - 1) * limit };
}

function buildListUrl({ basePath, page, q, categorySlug }) {
  const path = basePath || '/blog';
  const params = new URLSearchParams();
  if (page && page > 1) params.set('page', String(page));
  if (q) params.set('q', q);
  if (categorySlug && basePath === '/blog') params.set('category', categorySlug);
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

module.exports = {
  DEFAULT_LIMIT,
  parsePositiveInt,
  resolvePagination,
  buildListUrl,
};
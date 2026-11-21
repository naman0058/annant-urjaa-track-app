'use strict';

function parseVariants(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function absoluteUploadUrl(siteBase, publicPath) {
  if (!publicPath) return '';
  if (/^https?:\/\//i.test(publicPath)) return publicPath;
  const base = String(siteBase || '').replace(/\/$/, '');
  const p = publicPath.startsWith('/') ? publicPath : `/${publicPath}`;
  return base ? `${base}${p}` : p;
}

/**
 * Build src/sizes for responsive <img> from stored variants.
 */
function buildResponsiveImage({ featured, variants, siteBase }) {
  const v = parseVariants(variants) || {};
  const src = featured || v.original || '';
  if (!src) return null;

  const parts = [];
  const add = (url, w) => {
    if (url) parts.push(`${absoluteUploadUrl(siteBase, url)} ${w}w`);
  };

  add(v.w400 || v.webp400, 400);
  add(v.w800 || v.webp800, 800);
  add(v.w1200 || v.webp1200, 1200);
  add(v.webp || featured, 1600);
  add(featured, v.width || 1920);

  const srcset = [...new Set(parts.filter(Boolean))].join(', ');

  return {
    src: absoluteUploadUrl(siteBase, src),
    srcset: srcset || undefined,
    sizes: '(max-width: 600px) 100vw, (max-width: 1200px) 50vw, 820px',
    width: v.width,
    height: v.height,
    aspect: v.aspect,
  };
}

function extractFirstImageSrc(html) {
  if (!html) return null;
  const m = String(html).match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i);
  return m ? m[1].trim() : null;
}

const DEFAULT_ARTICLE_HERO = '/images/work-image-1.jpg';

/**
 * Hero for article pages: featured → og → first inline image → branded default.
 */
function buildArticleHeroImage({ featured, variants, ogImage, contentHtml, siteBase }) {
  if (featured) {
    const built = buildResponsiveImage({ featured, variants, siteBase });
    if (built) return { ...built, isPlaceholder: false };
  }
  if (ogImage) {
    const built = buildResponsiveImage({ featured: ogImage, variants: null, siteBase });
    if (built) return { ...built, isPlaceholder: false };
  }
  const inline = extractFirstImageSrc(contentHtml);
  if (inline) {
    const built = buildResponsiveImage({ featured: inline, variants: null, siteBase });
    if (built) return { ...built, isPlaceholder: false };
  }
  return {
    src: DEFAULT_ARTICLE_HERO,
    isPlaceholder: true,
  };
}

module.exports = {
  parseVariants,
  absoluteUploadUrl,
  buildResponsiveImage,
  extractFirstImageSrc,
  buildArticleHeroImage,
  DEFAULT_ARTICLE_HERO,
};
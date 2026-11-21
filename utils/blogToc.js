'use strict';

const slugify = require('./slugify');

function injectHeadingIds(html) {
  const used = new Map();
  let index = 0;
  const withIds = String(html || '').replace(
    /<h([2-4])(\s[^>]*)?>([\s\S]*?)<\/h\1>/gi,
    (match, level, attrs, inner) => {
      const text = inner.replace(/<[^>]+>/g, '').trim();
      if (!text) return match;
      let id = slugify(text).slice(0, 80);
      if (!id) id = `section-${index += 1}`;
      if (used.has(id)) {
        const n = (used.get(id) || 1) + 1;
        used.set(id, n);
        id = `${id}-${n}`;
      } else {
        used.set(id, 1);
      }
      const attrStr = attrs || '';
      if (/\bid\s*=/.test(attrStr)) return match;
      return `<h${level}${attrStr} id="${id}">${inner}</h${level}>`;
    }
  );

  const toc = [];
  const re = /<h([2-4])[^>]*\sid=["']([^"']+)["'][^>]*>([\s\S]*?)<\/h\1>/gi;
  let m;
  while ((m = re.exec(withIds)) !== null) {
    const text = m[3].replace(/<[^>]+>/g, '').trim();
    if (text) toc.push({ level: parseInt(m[1], 10), id: m[2], text });
  }

  return { html: withIds, toc };
}

module.exports = { injectHeadingIds };
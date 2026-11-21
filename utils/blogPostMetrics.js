'use strict';

function stripHtml(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function computeWordCount(contentHtml) {
  const text = stripHtml(contentHtml);
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

function computeReadingMinutes(wordCount) {
  if (!wordCount) return null;
  return Math.max(1, Math.ceil(wordCount / 200));
}

module.exports = { computeWordCount, computeReadingMinutes, stripHtml };
'use strict';

function mapImportModeToAi(mode) {
  const map = { ai_rewrite: 'full', preserve_format: 'content', metadata_only: 'metadata' };
  return map[mode] || 'full';
}

/**
 * Extra user-prompt rules for folder import (source doc is untrusted reference only).
 */
function getImportRewriteUserDirective(importMode) {
  if (importMode === 'metadata_only') {
    return '';
  }
  if (importMode === 'preserve_format') {
    return `Import mode — format cleanup:
- Improve HTML structure, spacing, and readability.
- Keep section order and heading text close to the source unless clearly broken.
- Do not invent new medical claims or statistics.`;
  }
  return `Import mode — copyright-safe rewrite (legacy doc = facts + title anchor):
- Legacy body text is reference for facts and meaning only — never copy sentences or paragraph structure.
- TITLE (tracking): Keep the post title recognizably similar to the legacy title so editors can match source files to CMS posts. Minor grammar/SEO tweaks OK; do not invent a unrelated headline.
- BODY (copyright): Rewrite the entire article in new words and a new outline. Same meaning and facts; no verbatim sentences and avoid copying phrases longer than a few common words.
- Do NOT reuse legacy section headings, subheadings, bullet labels, or section order — invent new h2/h3 titles.
- content_html (no h1):
  1) Fresh intro; 2) 3–6 new h2 sections with paraphrased content; 3) short readable paragraphs; 4) closing summary.
- subtitle and excerpt: new wording; meta_title may shorten for SEO but must reflect the same topic as the anchored title.
- key_takeaways and faqs: newly written, not copied from source.
- If a claim is unclear in the source, soften it and note in review_warnings.`;
}

function getTitleAnchorDirective(legacyTitle) {
  const t = String(legacyTitle || '').trim().slice(0, 200);
  if (!t) return '';
  return `Title anchor: Legacy title is "${t}". Output title must stay clearly the same article (same topic and wording mostly intact). Only small edits allowed (punctuation, grammar, ≤6 word clarifier). slug_suggestion should slugify this title.`;
}

module.exports = { mapImportModeToAi, getImportRewriteUserDirective, getTitleAnchorDirective };
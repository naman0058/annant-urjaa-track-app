'use strict';

const { z } = require('zod');

const FaqSchema = z.object({
  question: z.string().min(1).max(500),
  answer: z.string().min(1).max(3000),
});

/** Strict Structured Outputs contract + server-side re-validation */
const ArticleOutputSchema = z.object({
  title: z.string().min(1).max(200),
  slug_suggestion: z.string().max(240).nullable(),
  subtitle: z.string().max(500).nullable(),
  excerpt: z.string().max(600).nullable(),
  content_html: z.string().max(120000).nullable(),
  meta_title: z.string().max(70).nullable(),
  meta_description: z.string().max(320).nullable(),
  meta_abstract: z.string().max(500).nullable(),
  meta_keywords: z.string().max(500).nullable(),
  focus_keyword: z.string().max(120).nullable(),
  secondary_keywords: z.string().max(500).nullable(),
  search_intent: z
    .enum(['informational', 'commercial', 'transactional', 'navigational', 'mixed'])
    .nullable(),
  suggested_category: z.string().max(150).nullable(),
  suggested_tags: z.array(z.string().max(80)).max(20),
  suggested_image_alt: z.string().max(255).nullable(),
  og_title: z.string().max(100).nullable(),
  og_description: z.string().max(320).nullable(),
  twitter_title: z.string().max(100).nullable(),
  twitter_description: z.string().max(320).nullable(),
  faqs: z.array(FaqSchema).max(15),
  key_takeaways: z.array(z.string().max(500)).max(12),
  internal_link_suggestions: z.array(z.string().max(300)).max(12),
  suggested_external_sources: z.array(z.string().max(2000)).max(20),
  review_warnings: z.array(z.string().max(500)).max(25),
  confidence_notes: z.string().max(2000).nullable(),
});

const MetadataOnlySchema = ArticleOutputSchema.omit({ content_html: true }).extend({
  content_html: z.null(),
});

function parseArticleOutput(raw, mode = 'full') {
  const schema = mode === 'metadata' ? MetadataOnlySchema : ArticleOutputSchema;
  return schema.safeParse(raw);
}

module.exports = {
  ArticleOutputSchema,
  MetadataOnlySchema,
  parseArticleOutput,
  FaqSchema,
};
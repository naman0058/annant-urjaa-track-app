# Blog SEO

## Canonicals
- Articles: `SITE_BASE_URL/blog/{slug}` unless `canonical_url` is an absolute https URL in DB.
- List page 1: `/blog` or `/blog/category/{slug}`.
- List page 2+: self-referencing URL with `?page=N` (not canonicalized to page 1).
- Search `?q=`: `noindex,follow`.

## Metadata
Rendered via `seoMeta` in `header.ejs` (escaped with EJS `<%=`).

## JSON-LD (`buildArticleGraph`)
`@graph`: Organization, WebSite, WebPage, BlogPosting, BreadcrumbList, optional FAQPage when FAQs exist in `content_json`.

No invented ratings, credentials, or images.

## Sitemap & robots
- `/sitemap.xml` — static site URLs + published indexable posts + categories.
- `/robots.txt` — `Disallow: /admin/`, sitemap pointer.

## Internal links
`blogInternalLinksService` validates suggestions against published `/blog/{slug}` paths only.

## Verification
```bash
npm run validate:blog-seo
```
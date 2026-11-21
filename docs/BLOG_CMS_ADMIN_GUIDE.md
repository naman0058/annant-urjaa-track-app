# Blog CMS — Admin guide

## Access

- URL: `/admin/login` → **Blog CMS** (`/admin/blog`)
- Roles: **viewer** (read), **manager/super** (write), **super** (delete)

## Manual blog (TEST A)

1. **Blog CMS** → **New post** → fill title, body, SEO fields → **Save** (draft/review).
2. **Edit** → **Featured thumbnail** panel → upload image + alt text (optional).
3. **Publish now** (explicit) → verify public `/blog` and `/blog/{slug}`.

## SEO fields

Meta title/description, canonical, robots, OG/Twitter — right column on edit form. Persisted to `blog_posts`.

## AI (single post)

Post → **AI** link → generate preview → apply → remains **review**, not published.

## Internal links

Edit screen shows **verified** internal link suggestions (published slugs + site pages only).

## Import

See [`BLOG_CMS_AI_IMPORT.md`](BLOG_CMS_AI_IMPORT.md).

## Delete

Super only — soft delete (`deleted_at`). **No restore UI** yet; restore via DB if needed.
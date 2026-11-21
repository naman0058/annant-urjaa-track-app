# Featured images (manual upload only)

AI and folder import **never** set `featured_image`. Administrators upload thumbnails on the post edit screen after saving the article.

## Admin
- **Upload / replace:** `POST /admin/blog/:id/featured-image`
- **Remove:** `POST /admin/blog/:id/featured-image/remove` (clears DB; deletes files only when no other post references them)
- **Alt text:** `POST /admin/blog/:id/featured-image/alt`

## Validation (`services/blogFeaturedImageService.js`)
- Allowlisted MIME types + magic-byte verification
- Rejects executables / script-like content
- Size, min/max dimensions (configurable via `BLOG_IMAGE_*` env)
- Safe generated filenames under `public/uploads/blog/`
- Optional WebP + responsive widths via `sharp`

## Public site
- Listing: lazy-loaded images with `srcset` when variants exist
- JSON-LD (`utils/jsonLdBlog.js`): `image` property only when `featured_image` is set
- `og:image` only when a real featured image exists

## Placeholder
Posts without a thumbnail show an admin **Awaiting manual upload** state; public pages omit hero images and omit image from structured data.
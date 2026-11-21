# Public blog (site integration)

## Routes
| URL | Purpose |
|-----|---------|
| `GET /blog` | Listing (9 per page), optional `?page=` and `?q=` search |
| `GET /blog/category/:slug` | Category listing + pagination |
| `GET /blog/:slug` | Published article only; 301 from `blog_redirects` on old slug |

Route order: **category** is registered before **`:slug`** so slugs never capture category paths.

## Visibility
Only `status = published`, `allow_indexing = 1`, `deleted_at IS NULL`. Draft/review never served.

## Performance
- List queries: narrow column list + `LEFT JOIN` categories (no `content_html`)
- Separate `COUNT(*)` + paged `SELECT`
- In-memory cache (60s default, skipped for search queries)
- Cache bust on publish / slug change
- `Cache-Control` on list (60s) and article (300s) responses
- Lazy-loaded list thumbnails; responsive `srcset` when variants exist

## Content safety
`utils/sanitizePublicHtml.js` strips scripts/iframes/event handlers on output only.

## JSON-LD
`BlogPosting` in-page; `image` only when a real featured image exists.
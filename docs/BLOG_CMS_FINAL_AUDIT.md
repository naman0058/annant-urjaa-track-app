# Blog CMS final audit

## Completed in production-completion pass

1. **CSRF** — Global `POST` verification on `/admin` (except `/login`); `_csrf` on legacy commerce/catalog forms; removed debug `req.body` logging in `routes/admin.js`.
2. **Taxonomy** — `blogCategoryService`, `blogTagService`, routes at `/admin/blog/categories` and `/admin/blog/tags`, sidebar links, post editor category + comma-separated tags.
3. **Trash** — Soft delete → `/admin/blog/trash`, restore as draft with slug deconflict, super-only permanent purge, unpublish route, audit via `blogAuditService`.
4. **Tests** — Mock OpenAI fixture validation, webhook HMAC unit, sitemap trash filter, taxonomy parsing; SEO validate script extended.
5. **Docs** — This file, test results, production checklist.

## Explicitly not verified without approval

- OpenAI Responses API on real folders (paid).
- End-to-end browser smoke on every legacy admin form after CSRF (recommended manual spot-check on staging).

## Security notes (unchanged)

- `app.js` still ships default DB pool fallbacks — use `.env` in all deployments.
- Webhooks remain HMAC-only (no CSRF).
- `/api` unchanged.
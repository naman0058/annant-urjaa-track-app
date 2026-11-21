# Final acceptance checklist

Last verified: **2026-03-20**
- `npm test` — **16/16 unit tests pass**
- `RUN_INTEGRATION=1 npm run test:integration` — **3/3 pass** (robots, sitemap, admin redirect) on local DB

| Criterion | Status |
|-----------|--------|
| Existing site works without regressions | **Manual** — payment/API not auto-tested; no code changes to Razorpay routes. |
| Admin nav includes Blog Management | **Done** — sidebar Blog CMS + Folder import. |
| Manual blog CRUD + MySQL | **Done** |
| Categories and tags | **Partial** — DB + AI assign category/tags; **no dedicated admin tag/category UI**. |
| Draft / publish workflows | **Done** — explicit publish; AI never auto-publishes. |
| SEO fields editable | **Done** |
| OpenAI structured content | **Done** — requires live `OPENAI_API_KEY` for E2E; tests use mocks. |
| Folder importer multi-file | **Done** |
| Duplicate imports safe | **Done** |
| Retry failed items | **Done** — job UI + `retry-failed`. |
| Restart recovery | **Done** — DB queue + stale item reset; **run worker/cron after restart**. |
| Admin job monitor | **Done** — `/admin/blogs/jobs/:id` |
| AI posts stay draft/review | **Done** |
| Manual thumbnails | **Done** |
| Public listing + article pages | **Done** |
| Pagination 9/page | **Done** |
| Published-only public | **Done** |
| SEO metadata + JSON-LD + sitemap | **Done** — `npm run validate:blog-seo` |
| Security checks | **Documented** — `docs/SECURITY_VERIFICATION.md` |
| Automated tests | **Done** — `npm test` (unit); not full E2E TEST A–E without manual/live API. |
| Deployment docs | **Done** — `docs/BLOG_CMS_DEPLOYMENT.md` |

### Known limitations

- Post **restore** UI after soft-delete not implemented (archive only).
- Full **legacy admin CSRF** not rolled out.
- **E2E TEST A–E** require manual QA or `RUN_INTEGRATION=1` + DB credentials.
- Live OpenAI E2E **not run** in CI (by design).
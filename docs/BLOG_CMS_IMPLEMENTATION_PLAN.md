# Blog CMS — Implementation Plan (Phase 0 Audit)

**Project:** iTorus / MyApp (`c:\Project\iTorus\myapp`)  
**Date:** 2026-03-20  
**Status:** Phases 0–4 implemented (public blog, SEO, sitemap, tests). Phase 5: full legacy CSRF, tag admin UI, E2E automation with live DB.

---

## 1. Verified technology stack

| Layer | Verified choice | Notes |
|--------|-----------------|--------|
| Runtime | Node.js (v24.x observed locally) | `bin/www` HTTP server |
| Framework | Express 4.19 | `app.js` |
| Templates | EJS + `express-ejs-layouts` | Admin: `partials/layout`; public: `layout: false` + `header.ejs`/`footer.ejs` |
| Database | MySQL via `mysql2/promise` pool | Named placeholders `:param` |
| Auth (admin) | `express-session` + `admins` table + bcrypt | Roles: `super`, `manager`, `viewer` |
| Auth (API) | JWT in `routes/api.js` | Unchanged |
| Payments | Razorpay | Unchanged |
| Uploads | Multer → `public/uploads/{categories,tracks}` | Pattern reused for `blog` |
| CSS | Public `custom.css`; admin `public/css/admin.css` | Black/gold admin shell |
| Tests | `node:test` + `npm test` | Unit tests; integration optional `RUN_INTEGRATION=1` |
| Deploy | `npm start` → nodemon → `bin/www`, `PORT` env | No Docker/K8s in repo |

**Not installed (verified `package.json`):** OpenAI SDK, CSRF library, queue/worker, test runner. OpenAI called server-side via `fetch` + `OPENAI_API_KEY`.

**Security gaps identified:** `helmet` imported in `app.js` but not applied; no CSRF on admin POSTs today; DB credentials have fallbacks in `app.js` (pre-existing). Blog module adds session CSRF for its write routes and all new admin blog POSTs.

---

## 2. Existing modules (must preserve)

- `routes/index.js` — marketing pages, programs, contact
- `routes/admin.js` — dashboard, users, subscriptions, transactions, categories, tracks, masters
- `routes/api.js` — mobile app API, Razorpay
- `routes/webhooks.js`
- Static assets under `public/` (including legacy `blog.html` template — not replaced; superseded by dynamic `/blog` routes)

**No existing `blog_posts` table** in `sql/schema.sql`. No conflict with `categories` (different domain).

---

## 3. Public URL plan

| URL | Handler | Purpose |
|-----|---------|---------|
| `GET /blog` | `routes/blog.js` | Published list, pagination |
| `GET /blog/:slug` | `routes/blog.js` | Single post + SEO meta |
| `GET /sitemap.xml` | `routes/seo.js` | Static URLs + published posts |
| `GET /robots.txt` | `routes/seo.js` | Disallow `/admin/` |

Admin:

| URL | Purpose |
|-----|---------|
| `GET /admin/blog` | List, filters, bulk actions |
| `GET/POST /admin/blog/new`, `GET/POST /admin/blog/:id` | CRUD (draft default) |
| `POST /admin/blog/:id/publish` | Explicit publish only |
| `GET/POST /admin/blog/import` | CSV bulk import (skip duplicates) |
| `GET/POST /admin/blog/ai` | Queue bulk rewrite + SEO jobs |
| `POST /admin/blog/ai/run` | Process queued jobs (sync batch) |

---

## 4. Database migration plan

**Files:** `sql/migrations/001_blog_cms.sql`, `002_blog_cms_normalized.sql`, `scripts/migrate-blog-alter.js`  
**Apply:** `npm run migrate:blog` · **Verify:** `npm run verify:blog-schema`  
**Reference:** [`docs/BLOG_DATABASE.md`](BLOG_DATABASE.md)

### Tables

1. **`blog_posts`** — full SEO + workflow fields, soft delete, metrics (`word_count`, `seo_score`), `source_hash` idempotency  
2. **`blog_categories`**, **`blog_tags`**, **`blog_post_tags`**  
3. **`blog_import_jobs`**, **`blog_import_items`** — per-file idempotency  
4. **`blog_revisions`**, **`blog_redirects`**, **`blog_audit_logs`**  
5. **`blog_import_batches`**, **`blog_ai_jobs`** — legacy (retained)

**Rules enforced in application layer:**

- Default status: `draft`
- AI never sets `published`
- Import skips existing slug/hash unless `update_existing=1` on form
- Publish only via dedicated action or manual status + `published_at`

---

## 5. Architecture (modular)

```
middleware/adminAuth.js     ← shared requireAuth / requireRole
middleware/csrf.js          ← session CSRF token for admin writes
utils/slugify.js
utils/csvParse.js
services/openaiClient.js    ← server-only OpenAI (no browser keys)
services/blogRepository.js
services/blogImportService.js
services/blogAiService.js
routes/admin/blog.js        ← mounted at /admin/blog
routes/blog.js              ← public routes
views/admin/blog-*.ejs
views/blog-list.ejs, blog-single.ejs
```

`routes/admin.js` mounts `router.use('/blog', blogRouter)` — does not bloat monolithic file.

---

## 6. OpenAI integration

- **Env:** `OPENAI_API_KEY` (required for AI features), optional `OPENAI_MODEL` (default `gpt-4o-mini`)
- **Rewrite:** returns HTML → stored as `content_html`, status → `review`, `ai_rewritten=1`
- **SEO:** JSON fields → `meta_*`, `og_*`, `robots` (does not change publish status)
- **Errors:** surfaced in flash + job `error_message`; never log API key or full prompts with PII in production logs

---

## 7. CSRF

Session token `_csrf` in `req.session._csrf`, exposed as `res.locals.csrfToken` on admin routes, validated on all **blog** admin POSTs via `verifyCsrfPost`. (Extending to entire legacy admin POST surface is recommended in a follow-up pass.)

---

## 8. Deployment requirements

- Run `npm run migrate:blog` once per environment after deploy
- Set `OPENAI_API_KEY` on server (not in client)
- Ensure `public/uploads/blog` writable
- `PUBLIC_BASE_URL` used for canonical URLs in SEO generation

---

## 9. Compatibility risks

| Risk | Mitigation |
|------|------------|
| Long-running bulk AI on shared hosting | Batch size limit (5 jobs per run); admin triggers manually |
| Large `admin.js` merge conflicts | Blog isolated in `routes/admin/blog.js` |
| Static `/public/blog.html` vs `/blog` | Dynamic routes preferred; static file untouched |
| Viewer role posting content | Blog writes require `super` or `manager` |

---

## 10. Implementation phases & checkpoint

| Phase | Scope | Status |
|-------|--------|--------|
| **0** | Audit + this document | ✅ Done |
| **1** | DB migration, repository, admin CRUD, CSRF, nav | ✅ Implemented in this session |
| **2** | CSV import, AI jobs (rewrite + SEO), admin UI | ✅ Implemented in this session |
| **3** | Public `/blog` + SEO meta in header | ✅ Implemented in this session |
| **4** | Sitemap, RSS, homepage blog section, full admin CSRF | ⏳ Remaining |
| **5** | Automated tests, rate limits, scheduled publish cron | ⏳ Remaining |

### Resume checkpoint (if session splits)

1. Run `npm run migrate:blog` on target DB if tables missing.  
2. Verify `/admin/blog` after admin login.  
3. Set `OPENAI_API_KEY`, test `/admin/blog/ai` with one draft post.  
4. Continue Phase 4 from section 3 URL plan.

---

## 11. Git / secrets

- Do not commit `.env`
- Use `.env.example` for new keys only
- Unrelated local changes preserved (admin shell redesign, etc.)
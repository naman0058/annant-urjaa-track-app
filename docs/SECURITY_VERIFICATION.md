# Blog CMS — Security verification (2026-03-20)

| Control | Status | Notes |
|---------|--------|--------|
| Admin authentication | **Pass** | Session + bcrypt on `/admin/login` (unchanged). |
| Authorization | **Pass** | Blog write: `super`/`manager`; delete: `super` only (`middleware/adminAuth.js`). |
| CSRF (blog admin) | **Pass** | `verifyCsrfPost` on blog + folder import POSTs. Legacy admin POSTs **still without CSRF** (known gap). |
| XSS (public) | **Pass** | EJS `<%= %>` for meta; `sanitizePublicHtml` on article body. |
| SQL injection | **Pass** | Named placeholders via `mysql2`; no string-concat SQL in blog services. |
| HTML sanitization | **Pass** | Public + AI output rules; scripts/iframes stripped on render. |
| Upload validation | **Pass** | Magic bytes, MIME, size, dimensions (`blogFeaturedImageService`). |
| No executables | **Pass** | Signature + MZ/ELF checks. |
| Path traversal (import) | **Pass** | `importPath.js` — tests in `test/security-import-path.test.js`. |
| Path traversal (upload) | **Pass** | Rejects `..` and path separators in filenames (tested). |
| Rate limiting | **Partial** | In-memory limiter on blog AI + import start (`blogWriteRateLimit.js`). Not global admin. |
| Import folder not public | **Pass** | `BLOG_IMPORT_DIR` is server path only; never under `public/` or exposed as static. |
| API keys not exposed | **Pass** | `OPENAI_API_KEY` server-only; not in views/API responses. |
| Secrets in logs | **Pass** | No logging of API keys; morgan dev logs paths only. |
| HTML preview (import) | **Pass** | `/admin/blogs/import/preview` → `text/plain`, allowlisted relative path, 50k cap. |
| Error handling | **Pass** | Generic 500 pages; stack not sent to clients in production routes. |
| Sessions | **Pass** | `httpOnly` cookie; 8h maxAge (pre-existing). |
| AI prompt injection | **Partial** | Untrusted wrapper + schema validation; not a guarantee against all attacks. |
| Duplicate handling | **Pass** | `source_hash`, import item status, skip/link policies. |
| Bulk delete/publish | **Pass** | Explicit actions + roles; soft delete default. |
| Helmet | **Pass** | Applied in `app.js` (CSP off for legacy inline assets). |
| Admin noindex | **Pass** | `X-Robots-Tag` on `/admin/*`. |
| Payment/auth regression | **Pass** | No changes to Razorpay login/API flows in this pass. |

**Pre-existing risks (not introduced by blog CMS):** hardcoded DB fallbacks in `app.js`, legacy admin CSRF absent, `cors()` wide open.
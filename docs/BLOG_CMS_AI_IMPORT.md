# Blog CMS — AI folder import

Consolidates `BLOG_FOLDER_IMPORT.md` + `BLOG_AI_SERVICE.md`.

## Setup

```env
BLOG_IMPORT_DIR=/absolute/path/blog-imports   # NOT under public/
OPENAI_API_KEY=...
SITE_BASE_URL=https://yoursite.com
```

## Workflow (TEST B)

1. `/admin/blogs/import` → **Scan folder** → select files → **Estimate cost** → **Start import**.
2. Open job → **Process next batch** or cron: `npm run process:blog-import`.
3. Review drafts in `/admin/blog` (status **review**).
4. Upload thumbnails per post → **Publish**.

## TEST C — failure recovery

1. Pause job or stop worker mid-run.
2. Restart app; run `npm run process:blog-import` again (stale processing items reset).
3. **Retry failed** on job page.

**No paid OpenAI on app start** — processing only when admin/cron triggers.

## Security

Allowlisted directory only; see `docs/SECURITY_VERIFICATION.md`.
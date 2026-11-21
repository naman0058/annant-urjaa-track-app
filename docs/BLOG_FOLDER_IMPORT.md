# Bulk folder import (AI)

## Routes
- `GET /admin/blogs/import` — **Import Studio** (6-step workflow: scan → select → configure → estimate → confirm)
- `GET /admin/blogs/jobs` — import history
- `GET /admin/blogs/jobs/:id` — progress, per-file status, pause/resume/cancel/retry
- `GET /admin/blogs/jobs/:id/review` — results + compare source vs draft
- `GET /admin/blogs/jobs/:id/status.json` — polling endpoint (DB-backed)
- JSON: `POST /import/scan`, `GET /import/scan/:scanId/entries`, `GET /import/preview.json`, `POST /import/estimate`, `POST /import/start` (with `confirm_cost=1`)

Legacy synchronous folder button remains on `/admin/blog/ai` (small batches only).

## Security
- Only `BLOG_IMPORT_DIR` (resolved absolute path) may be read
- Subpaths must be relative (`..` and absolute paths rejected)
- Symlinks skipped; hidden/temp files ignored; max file size from env
- Source preview uses allowlisted relative paths only

## Formats
| Extension | Support |
|-----------|---------|
| `.md`, `.txt`, `.html`, `.json` | Yes |
| `.docx` | Yes when `BLOG_IMPORT_ENABLE_DOCX=1` (mammoth) |
| `.pdf` | Skipped with reason |

## Processing
1. Admin confirms cost and starts job → rows in `blog_import_jobs` / `blog_import_items`, status `queued`
2. Run workers via **Process next batch**, job page auto-batch (when worker env off), **`BLOG_IMPORT_WORKER_ENABLED=1`**, or cron:
   ```bash
   npm run process:blog-import
   # optional: npm run process:blog-import -- --job=12 --limit=3
   ```
3. Concurrency/rate limits: `OPENAI_MAX_CONCURRENT_REQUESTS`, retries with jitter, 429 handling
4. Each file failure does not stop the batch

## Duplicate policy (defaults)
- Same **file hash** → skip (or link for review)
- Same **title** → suffix slug (or skip)
- No destructive overwrite

## Env
See `.env.example` (`BLOG_IMPORT_*`, OpenAI vars).

## Post state
- Status `review`, `ai_review_status` `pending`, `featured_image` null
- Thumbnails and publish remain manual
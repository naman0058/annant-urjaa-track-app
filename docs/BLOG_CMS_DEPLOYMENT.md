# Blog CMS — Deployment

## Stack

Node 18+, Express 4, MySQL 8+, EJS. **No change** to payment webhooks or mobile API deployment.

## Install

```bash
npm install
npm run migrate:blog
npm run verify:blog-schema
```

## Environment

Copy `.env.example` → `.env`. Required: `DB_*`, `SESSION_SECRET`, `SITE_BASE_URL` (production canonicals/sitemap).

Blog-specific: `OPENAI_*`, `BLOG_IMPORT_DIR`, `BLOG_IMAGE_*`, `BLOG_PUBLIC_CACHE_MS`.

## Process

```bash
npm start          # dev (nodemon)
# production: node bin/www with PORT set
```

## Worker / cron (import queue)

```bash
# every 2–5 minutes
npm run process:blog-import
# optional: npm run process:blog-import -- --job=12 --limit=2
```

## Import folder

- Place source `.md`, `.txt`, `.html`, `.json` (optional `.docx`) in `BLOG_IMPORT_DIR`.
- Directory must be **outside** `public/`.

## QA commands

```bash
npm test                    # unit tests (no OpenAI)
npm run validate:blog-seo
RUN_INTEGRATION=1 npm run test:integration   # needs live DB
```

## Public SEO (TEST D)

1. Visit `/blog`, page 2 (`?page=2`), open article.
2. View source: canonical, meta, JSON-LD `@graph`.
3. `/sitemap.xml`, `/robots.txt`.
4. Confirm draft slug returns 404 publicly.

## Backup

 mysqldump before migrations. Job/post state in `blog_import_*` and `blog_posts`.
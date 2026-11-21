# Blog CMS — Database Guide

## Schema overview

| Table | Purpose |
|-------|---------|
| `blog_posts` | Canonical article row (SEO + content + workflow + soft delete) |
| `blog_categories` | Taxonomy + category SEO |
| `blog_tags` / `blog_post_tags` | Many-to-many tags |
| `blog_import_jobs` / `blog_import_items` | Directory/file import with per-file idempotency |
| `blog_revisions` | JSON snapshots for restore/review |
| `blog_redirects` | 301 slug history after URL changes |
| `blog_audit_logs` | Admin actions (no secrets in `metadata_json`) |
| `blog_import_batches` | Legacy CSV import (retained) |
| `blog_ai_jobs` | Legacy AI queue (retained) |

### Normalization notes

- **Tags** and **categories** are not duplicated on `blog_posts` except `category_id` FK.
- **Revisions** store a **snapshot JSON** instead of cloning every column.
- **SEO enrichment** lives on `blog_posts` (single source of truth for published output).
- **`content_json`** is optional structured content; **`content_html`** remains the render default.

## Migrations (order)

```bash
npm run migrate:blog
npm run verify:blog-schema
```

1. `sql/migrations/001_blog_cms.sql` — base `blog_posts`, legacy import/AI tables  
2. `sql/migrations/002_blog_cms_normalized.sql` — categories, tags, import jobs/items, revisions, redirects, audit  
3. `scripts/migrate-blog-alter.js` — idempotent `blog_posts` column adds/renames + indexes  

**Never** runs `DROP` or `TRUNCATE` on production tables.

## Indexes (pagination & scale)

- Public listing: `(status, allow_indexing, published_at, deleted_at)`
- Admin filters: `updated_at`, `status`, `category_id`
- Import idempotency: `UNIQUE (job_id, file_name)`, `UNIQUE (job_id, file_hash)`
- Slug: `UNIQUE (slug)`; redirects: `UNIQUE (old_slug)`

## Backup (before migrate)

```bash
# MySQL dump (replace credentials; do not commit output)
mysqldump -h %DB_HOST% -u %DB_USER% -p %DB_NAME% \
  blog_posts blog_categories blog_tags blog_post_tags \
  blog_import_jobs blog_import_items blog_revisions blog_redirects blog_audit_logs \
  blog_import_batches blog_ai_jobs > blog_cms_backup_%DATE%.sql
```

Store dump off-server. For managed hosting, use provider snapshot + logical dump.

## Rollback strategy

1. **Application rollback**: deploy previous git tag (old code may expect old column names — `blogRepository` keeps legacy aliases).  
2. **Schema rollback**: restore from backup dump to a **staging** DB first; production restore only with maintenance window.  
3. **Partial rollback**: new tables from 002 can remain unused if app is reverted; dropped columns from manual rollback require backup restore (migrations do not drop columns).

## Transactions & duplicates

- CSV/import services use **transactions** where multi-row writes occur.
- **`source_hash`** / **`file_hash`** uniqueness prevents duplicate imports per job.
- **Slug** uniqueness enforced at DB level; app uses `blog_redirects` on slug change after publish.

## MySQL compatibility

- **InnoDB**, **utf8mb4_unicode_ci** (full UTF-8).
- Tested against **MySQL 8.x / MariaDB 10.x** patterns (`JSON`, `ENUM`, FK).
- Requires `FOREIGN_KEY_CHECKS` enabled (default).

## Charset

All blog tables use `utf8mb4` for emoji and international content.
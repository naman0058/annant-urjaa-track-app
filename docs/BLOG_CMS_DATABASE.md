# Blog CMS — Database

Same content as legacy `BLOG_DATABASE.md`, renamed for the documentation set.

## Commands

```bash
npm run migrate:blog
npm run verify:blog-schema
```

## Tables

See [`BLOG_DATABASE.md`](BLOG_DATABASE.md) for full table list, indexes, and rollback notes.

## Backup / rollback

1. Backup MySQL before `npm run migrate:blog`.
2. Migrations are **additive** (CREATE + idempotent ALTER). No automatic DROP.
3. To roll back application code, deploy prior git tag; DB columns may remain harmless.
4. Import/job recovery: inspect `blog_import_jobs`, `blog_import_items`; failed rows keep `error_message`.
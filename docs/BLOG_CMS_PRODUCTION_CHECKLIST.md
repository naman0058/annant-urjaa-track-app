# Blog CMS production checklist

| Item | Status |
|------|--------|
| Public `/blog` list + article | PASS (prior + regression tests) |
| Admin blog CRUD draft-first | PASS |
| Blog categories/tags admin UI | PASS (this pass) |
| Trash / restore / purge (super) | PASS (this pass) |
| Unpublish | PASS (this pass) |
| Folder + CSV import | PASS (code); live OpenAI **NOT RUN** |
| Sitemap excludes trash | PASS |
| Admin POST CSRF (excl. login) | PASS (this pass) |
| Legacy admin forms `_csrf` | PASS (this pass) |
| Audit logs on trash/taxonomy | PASS (this pass) |
| Live OpenAI paid calls | **NOT RUN** |
| Live payment webhooks | **NOT RUN** (no code changes to capture logic) |
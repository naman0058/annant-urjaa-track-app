# Import Studio QA (Phase 7)

Run `npm test` and manual checks on `/admin/blogs/import` with `BLOG_IMPORT_DIR` set.

| # | Check | Pass |
|---|--------|------|
| A | Configured folder scans (step 1) | ☐ |
| B | Nested scan toggle | ☐ |
| C | Path traversal rejected (automated) | ☐ |
| D | Summary counts match scan | ☐ |
| E | Skipped drawer lists reasons | ☐ |
| F | Search + status filter | ☐ |
| G | Select page vs all eligible | ☐ |
| H | Selection persists (sessionStorage) | ☐ |
| I | Preview drawer (JSON) | ☐ |
| J | AI modes in config | ☐ |
| K | Cost estimate not inflated (heuristic/extract) | ☐ |
| L | Cannot start without selection | ☐ |
| M | Confirm cost required | ☐ |
| N | Job durable after refresh | ☐ |
| O | Progress poll + optional auto-batch | ☐ |
| P | Import history paginated | ☐ |
| Q | Review compare drawer | ☐ |
| R | No API key in browser | ☐ |

Do not run a full paid production batch for QA.
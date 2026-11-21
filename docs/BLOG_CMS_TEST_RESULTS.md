# Blog CMS test results (localhost)

Generated during production-completion pass. Live OpenAI / paid API: **NOT RUN** (requires explicit approval).

| Suite | Command | Result |
|-------|---------|--------|
| Unit | `npm test` | **PASS** — 23/23 |
| Integration | `RUN_INTEGRATION=1 npm run test:integration` | **PASS** — 3/3 |
| SEO script | `npm run validate:blog-seo` | **PASS** |
| Live OpenAI import (TEST B) | Manual / staging | **NOT RUN** |
| Razorpay live payments | N/A | **NOT RUN** (unchanged) |

## New coverage this pass

- `test/blog-taxonomy-unit.test.js` — tag input parsing
- `test/blog-import-mock.test.js` — mock OpenAI fixture + Zod
- `test/webhook-hmac.test.js` — HMAC helper regression
- `test/blog-sitemap-trash.test.js` — sitemap excludes `deleted_at`
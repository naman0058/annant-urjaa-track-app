# End-to-end test scripts (manual)

Automated coverage is in `test/` (mocked OpenAI). These scripts are **manual** unless you run them in staging with real credentials.

## TEST A — Manual blog

Login → `/admin/blog/new` → save draft → edit → upload thumbnail → publish → `/blog/{slug}`.

## TEST B — AI import

Add files under `BLOG_IMPORT_DIR` → scan → start job → process batches → review → thumbnail → publish.

## TEST C — Failure recovery

Start import → kill worker mid-batch → `npm run process:blog-import` → retry failed → no duplicate completed items (same hash skipped).

## TEST D — Public SEO

`/blog` → page 2 → article → inspect head + JSON-LD → `/sitemap.xml` → draft URL 404.

## TEST E — Regression

`/`, `/programs`, `/api/...` smoke, Razorpay webhook unchanged, admin login unchanged.
# Admin QA report

## Automated tests (executed)

| Command | Result |
|---------|--------|
| `npm test` | **PASS** — 42/42 (includes `admin-reports-service`, `csv-safe`, dashboard core) |
| `RUN_INTEGRATION=1 npm run test:integration` | **PASS** — 6/6 (3 admin route auth + 3 public) |
| `npm run migrate:admin` | **PASS** |
| `npm run build:admin-css` | **PASS** |

## Manual / browser

- Dashboard compact layout, filter drawer, revenue chart: **not browser-automated** — smoke on `http://localhost:3000/admin/dashboard` after login recommended.
- Reports & Analytics tabs, compare, CSV exports (`/admin/reports`, `/admin/reports.csv`): **not browser-automated** — verify overview KPI/chart reconciliation and tab query persistence manually.
- Staff CRUD: **requires super** session — manual verify recommended.
- Responsive breakpoints 768/390: **not fully automated**.

## Unverified

- Razorpay refund flows: **NOT RUN**
- Live OpenAI blog import: **NOT RUN**
- WCAG contrast audit: **NOT RUN** (tokens chosen for contrast intent)

## Production blockers called out

- Remove hardcoded DB fallbacks in [app.js](../app.js) for production.
- Ensure `SESSION_SECRET` and `DB_*` in `.env` only.
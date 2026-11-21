# Admin Dashboard — Phase 2 Implementation

## Root cause (visual issues)

Shared **`.btn`, `.input`, `.select`, `.panel`, `.table`** styles were documented but never shipped in `admin.css` (only tokens + shell + partial components). Dashboard and filter drawer rendered native white controls.

## Files changed / added

| File | Change |
|------|--------|
| `public/css/admin-forms.css` | **New** — buttons, inputs, selects, panels, tables |
| `public/css/admin-dashboard.css` | **New** — grid, KPI links, chart shells, action list |
| `scripts/consolidate-admin-css.js` | Includes new CSS in `admin.css` build |
| `services/adminDashboardService.js` | 90d preset, granularity, period failed KPI, chart aggregation, filter counts |
| `views/dashboard.ejs` | Full layout: header, KPIs, 2 charts, recent tx, action panel, filter drawer |
| `public/js/admin-dashboard.js` | Chart.js revenue + subscription charts, preset/refresh, date validation |
| `public/js/admin.js` | Drawer focus trap, Escape close, body scroll lock |
| `public/css/admin-shell.css` | Subtle sidebar scrollbar; `.visually-hidden` |
| `views/partials/header.ejs` | Hides duplicate page title (a11y retained) |
| `views/partials/layout.ejs` | Cache bust `admin.css?v=3`, `admin.js?v=2` |
| `routes/admin/dashboard.js` | Error fallback fields |
| `test/admin-dashboard-service.test.js` | Date range + aggregation unit tests |
| `docs/ADMIN_DESIGN_SYSTEM.md` | Form controls + dashboard section |

## KPI definitions

| KPI | Query |
|-----|--------|
| Captured revenue | `SUM(transactions.amount)` in range, default `status=captured` (paise) |
| New subscriptions | `COUNT(*)` subscriptions created in range (+ track / sub status filters) |
| New members | `COUNT(*)` users registered in range (no tx/sub filters) |
| Failed payments | `COUNT(*)` `status=failed` **in selected date range** |

Period comparison uses the immediately preceding window of equal length (`formatPeriodDelta`).

## Chart data

- **Revenue:** daily SQL buckets → `aggregateDailyRows` → optional weekly/monthly via `granularity` query param.
- **Subscriptions:** same pattern on `subscriptions.created_at`.
- **Library:** Chart.js 4.4 (CDN in layout).
- **Zero data:** compact empty state inside fixed 280px chart area (no oversized blank canvas).

## Tests executed

```text
npm run build:admin-css   — OK
npm test                  — 30/30 pass (includes 4 new dashboard service tests)
```

Integration dashboard browser test not run (requires admin session). Manual: login → `/admin/dashboard`.

## Phase 2B (production refinement)

- **Date state:** Named presets always recompute `from`/`to` and ignore stale query dates; preset dropdown shows **Custom range** when active; active filter count counts only business filters (not custom dates).
- **Revenue empty state:** Uses **KPI + series sum** (`stats.salesAmount` in chart payload), not series-only (fixed false “no payments” overlay).
- **Reconciliation:** `chartMeta.revenueReconciled` compares `SUM(chart buckets)` to KPI paise; regression tests in `test/admin-dashboard-service.test.js`.
- **Aggregation:** 1–31 daily, 32–180 weekly, 181+ monthly (override via `granularity_set=1`); SQL `GROUP BY` matches bucket granularity.
- **Transactions:** Period-scoped recent list; `in_transit` labels; stale in-transit (48h+) in Action Required when applicable.

## Remaining / follow-ups

- Drill-down URLs pass dashboard query params; list modules may ignore `from`/`to` until those filters are wired on transactions/users pages.
- Topbar eyebrow still shows “iTorus / Admin” (branding alignment with Anannt Urjaa is a separate pass).
- Live payment data required to verify non-empty chart tooltips in production.
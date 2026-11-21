# Admin Reports & Analytics (Phase 3)

## Routes

| Route | Purpose |
|-------|---------|
| `GET /admin/reports` | Interactive reporting UI (`?tab=`, filters) |
| `GET /admin/reports.csv` | Export (`export=summary\|breakdown\|transactions`) |

Default preset: **Last 30 days** (same canonical logic as dashboard via [`adminReportingCore.js`](../services/adminReportingCore.js)).

## Tabs

`overview` · `revenue` · `subscriptions` · `members` · `tracks` · `transactions`

## Metric definitions

| Metric | Definition |
|--------|------------|
| Captured revenue | `SUM(transactions.amount)` with `tx_status` filter (default `captured`) |
| Total transactions | `COUNT(*)` in range; all statuses when default `tx_status=captured`, else filtered |
| New subscriptions | Subscriptions with `created_at` in range |
| New members | Users with `created_at` in range (ignores tx filters) |
| Refunded | Sum where `status=refunded` in range |

Revenue chart bucket sum must equal captured revenue KPI when scopes match (`revenueReconciled`).

## Compare modes

`prev_period` (default) · `prev_month` · `prev_year` · `none`

## Phase 3B layout

- Overview uses `.dashGrid` with explicit `.dashGrid__span-6` / `span-8` / `span-4` (missing `span-6` previously caused single-column collapse).
- Chart heights: revenue ~300px, bar charts ~240px, compact empty states ~120–180px.
- Transaction status donut: center total + side legend; status colors (not gold).
- Period breakdown: client pagination, optional hide zero-activity rows (display only; CSV export unchanged).

## Limitations

- No net profit without cost data.
- Revenue-by-track only when `transactions.track_id` exists.
- Excel/PDF exports not implemented.
- New subscriptions use `created_at` only (not renewals).

## Tests

```bash
npm test
```

See `test/admin-reports-service.test.js`, `test/csv-safe.test.js`.
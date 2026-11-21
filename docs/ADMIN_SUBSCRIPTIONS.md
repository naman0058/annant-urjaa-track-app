# Admin — Subscriptions Management Center

## Routes

| Method | Path | Access |
|--------|------|--------|
| GET | `/admin/subscriptions` | All authenticated roles (read) |
| GET | `/admin/subscriptions.csv` | Authenticated; same filters as list (cap 10k) |
| GET | `/admin/subscriptions/lookup/tracks?q=` | Track typeahead for create/edit |
| GET | `/admin/subscriptions/:id` | Detail, audit history, related transactions |
| POST | `/admin/subscriptions` | super, manager |
| POST | `/admin/subscriptions/:id` | super, manager |
| POST | `/admin/subscriptions/:id/cancel` | super, manager |
| POST | `/admin/subscriptions/:id/delete` | super only |

Viewer accounts are blocked from POST via `blockViewerWrites`.

## KPI row

- **Matching results** — count for the current filter set (table pager total).
- **Active now** — snapshot: `status = active` and (`end_date IS NULL` or `end_date > today`). Unfiltered.
- **Expiring in 7 days** — snapshot: active with `end_date` within the next 7 days. Unfiltered.

## Manual grant (active)

Creating or re-activating (`cancelled` / `expired` → `active`) requires a **grant reason** (≥ 3 characters) for managers. Super may omit on create only. Actions are logged in `admin_audit_logs` as `subscription.admin_grant`, `subscription.create`, `subscription.update`, `subscription.cancel`, or `subscription.delete`.

## Cancel vs delete

- **Cancel** sets `status = cancelled` (primary lifecycle action).
- **Delete** is a hard delete (super only, confirm in UI). Payment history remains in `transactions`.

## Schema note

Runtime detects `subscriptions.track_id` vs legacy `subscriptions.track`. List/export join `tracks` when `track_id` exists.

## Related payments vs member history

- **Related payments** — only rows where `transactions.subscription_id` equals this subscription (set on forward Razorpay captures after migration `006`).
- **Member transaction history** — paginated member-wide orders; **not** proof this subscription was paid.
- No retroactive backfill; legacy rows keep `subscription_id` NULL.

Apply migration (dev/staging only when authorized):

`npm run migrate:sub-payment-link`

Rollback: `npm run migrate:sub-payment-link:down`

## Complimentary active access

Manual **active** grants app entitlement (`userHasPremiumAccess`). Managers must check **confirm complimentary active** and supply a grant reason (audited). Payment records are never fabricated.

## Limitations

- No `pending` status; Razorpay capture/refund behavior unchanged aside from optional `subscription_id` link on success.
- Export uses `utils/csvSafe.js` (formula-injection safe).
# iTorus Admin Module Audit

**Stack:** Node.js, Express 4, EJS, MySQL2, session auth (`admins.role`: super | manager | viewer).

**Audit date:** Production rebuild baseline.

## MLM / network compensation

**N/A — not in business model.** No genealogy, commission, rank, wallet, or payout tables/routes in repository.

## Module coverage matrix

| Module | Routes (GET) | Write roles | CRUD | List filters | Detail view | Export | DB tables | Gaps / risks |
|--------|--------------|-------------|------|--------------|-------------|--------|-----------|----------------|
| Login | `/admin/login` | public | — | — | — | — | `admins` | No MFA |
| Dashboard | `/admin/dashboard` | auth | — | date, track, sub/tx status | — | — | users, subscriptions, transactions | Large filter panel; +100% delta when prior=0; no action queue |
| Users | `/admin/users`, `.csv` | POST super/manager; delete super | C,R,U,D | q, from, to, sort, page | **Missing** | CSV | `users` | No detail; inline edit only |
| Subscriptions | `/admin/subscriptions`, `.csv`, `/:id`, lookup | POST super/manager; cancel POST; delete super | C,R,U,D | q, status, track, member, date ranges | **Yes** (`subscription-detail`) | CSV (`csvSafe`) | `subscriptions`, `tracks`, `admin_audit_logs` | Legacy `track` column still supported; hard delete only |
| Transactions | `/admin/transactions`, `.csv` | **read-only** (webhook writes) | R | rich filters | **Missing** | CSV | `transactions` | No refund admin; immutable $ |
| Categories | `/admin/categories` | super/manager; delete super | C,R,U,D | — | — | — | `categories` | `cms` UI root; hardcoded thumb host |
| Tracks | `/admin/tracks` | super/manager; delete super | C,R,U,D | category, q | — | — | `tracks` | Media upload |
| Master codes | `/admin/masters` | super/manager; delete super | C,R,U,D,toggle | q, status, validity | **Missing** | — | `master_codes`, redemptions | 5000 users in dropdown |
| Blog CMS | `/admin/blog/*`, `/admin/blogs/*` | super/manager | full | varies | edit | CSV/import | `blog_*` | Visual drift vs commerce |
| Staff | — | — | — | — | — | — | `admins` | **Not implemented** |
| Reports | — | — | — | — | — | — | — | **Not implemented** |
| Admin audit | — | — | — | — | — | — | — | Blog-only `blog_audit_logs` |
| Global search | header → transactions `q` | — | — | — | — | — | — | Not cross-entity |

## Permissions summary

| Role | Typical access today |
|------|----------------------|
| super | All POST routes including deletes |
| manager | Users, subs, catalog, masters (no user delete) |
| viewer | **Same GET as others; POST not restricted by role on most routes** — gap |

## Security (baseline)

- CSRF on all admin POST except `/login`
- Server `requireRole` on destructive/sensitive POSTs
- Razorpay webhook HMAC in `routes/webhooks.js`
- `app.js` default DB credentials in code — **production risk**

## Rebuild targets (this project)

1. Unified Midnight & Muted Gold design system
2. Shared EJS partials + filter drawer pattern
3. Dashboard service + honest KPI deltas + action queue
4. Detail routes: users, subscriptions, transactions
5. Staff & Roles (super writes)
6. Reports + `admin_audit_logs`
7. Viewer read-only enforcement
8. Blog admin visual alignment
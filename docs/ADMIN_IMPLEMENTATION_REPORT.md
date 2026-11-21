# Admin implementation report

## Completed

- **Audit & design:** [ADMIN_MODULE_AUDIT.md](ADMIN_MODULE_AUDIT.md), [ADMIN_DESIGN_SYSTEM.md](ADMIN_DESIGN_SYSTEM.md), tokens + components CSS, `npm run build:admin-css`.
- **Shell:** Sidebar groups (Overview, Operations, Catalog, Content, People, Administration), global search → `/admin/search`, filter drawer JS, `.page` wrapper on major views.
- **Dashboard:** [services/adminDashboardService.js](../services/adminDashboardService.js), [routes/admin/dashboard.js](../routes/admin/dashboard.js), honest KPI deltas via [utils/adminDelta.js](../utils/adminDelta.js).
- **Commerce details:** `GET /admin/users/:id`, `/subscriptions/:id`, `/transactions/:id`, `/users/lookup`.
- **Reports:** `/admin/reports`, CSV export.
- **Staff & roles:** `/admin/staff` (super write), `admins.is_active`, login blocks deactivated.
- **Audit:** `admin_audit_logs` table, `/admin/audit`, [services/adminAuditService.js](../services/adminAuditService.js).
- **Security:** `blockViewerWrites` middleware, `res.locals.canWrite` / `isViewer`.
- **Masters:** Remote user lookup (no 5000-user preload).
- **Blog admin:** `.page` layout on all `views/admin/blog-*`.

## Migrations

- `npm run migrate:admin` — `005_admin_platform.sql` + `admins.is_active`.

## Route modularization (partial split from monolith)

Mounted routers: `dashboard`, `search`, `reports`, `staff`, `audit`, `details`, `blog`, `blogs`. Core CRUD remains in [routes/admin.js](../routes/admin.js) for stability.

## Known limitations

- Full filter-drawer migration not applied to every list page (transactions/subscriptions retain inline GET filters).
- Transaction refunds not implemented (Razorpay not wired in admin).
- Viewer role blocked on POST globally; some UI still shows forms (wrap with `canWrite` ongoing).
- `app.js` default DB credentials remain a deployment risk.
- Live payment / OpenAI verification: **NOT RUN**.
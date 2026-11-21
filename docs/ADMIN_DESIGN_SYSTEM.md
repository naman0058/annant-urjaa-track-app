# iTorus Admin Design System

**Theme:** Midnight & Muted Gold (Executive).

**Source files:** [public/css/admin-tokens.css](../public/css/admin-tokens.css), [public/css/admin-shell.css](../public/css/admin-shell.css), [public/css/admin-components.css](../public/css/admin-components.css) → `npm run build:admin-css` → [public/css/admin.css](../public/css/admin.css).

## Color tokens

| Token | Hex | Use |
|-------|-----|-----|
| Canvas | `#090B0F` | Page background |
| Sidebar | `#101318` | Navigation |
| Surface | `#14181E` | Cards, panels |
| Elevated | `#1B2028` | Drawers, dropdowns |
| Border | `#2B313A` | Dividers |
| Gold | `#D7AF45` | Primary CTA, active nav |
| Success / Warning / Danger / Info | see tokens | Status only |

Gold is **not** used for body text.

## Typography

Inter (Google Fonts). Page title 26px; section 16–18px; body 14px; tables 13–14px. Financial values use `font-variant-numeric: tabular-nums`.

## Spacing

4px base: 8, 12, 16, 24, 32. Card padding 16–20px. Content gutter 24px (`--admin-gutter`). Control height 42px.

## Radius

Cards and panels: 10–12px (`--admin-radius-sm` / `--admin-radius`).

## Layout

- Sidebar expanded 248px; collapsed target 72px (JS toggle).
- Sticky topbar 56px.
- Max content width 1440px (`.page`).

## Components (EJS partials)

| Partial | Path |
|---------|------|
| Page header | [views/partials/admin/page-header.ejs](../views/partials/admin/page-header.ejs) |
| Filter drawer | [views/partials/admin/filter-drawer.ejs](../views/partials/admin/filter-drawer.ejs) |
| Table toolbar | [views/partials/admin/data-table-toolbar.ejs](../views/partials/admin/data-table-toolbar.ejs) |
| Empty state | [views/partials/admin/empty-state.ejs](../views/partials/admin/empty-state.ejs) |
| Status badge | `.statusBadge` + modifier classes |
| CSRF | [views/partials/csrf-field.ejs](../views/partials/csrf-field.ejs) |

## Form controls (`admin-forms.css`)

- `.input`, `.select` — dark surface `#1B2028`, 42px height, gold focus ring.
- `input[type="date"]` uses `color-scheme: dark` (no native white pickers).
- `.field` + `.label` for filter drawers and CRUD forms.

## Buttons

- `btn btn--primary` — gold primary action (one per page header).
- `btn btn--gold` — secondary emphasis / export.
- `btn btn--ghost` — neutral.
- `btn btn--danger` — destructive (with confirm).

## RBAC UI

- `viewer`: lists and detail GET only; hide POST forms and action buttons.
- `manager`: commerce/catalog writes; no staff admin.
- `super`: staff, deletes, purge.

## Authentication screen (Phase 1)

Standalone login uses [public/css/admin-tokens.css](../public/css/admin-tokens.css) + [public/css/admin-login.css](../public/css/admin-login.css) and [public/js/admin-login.js](../public/js/admin-login.js).

| Element | Class / token |
|---------|----------------|
| Page | `.admin-login-page`, `--it-canvas` |
| Card | `.admin-login-card`, `--it-surface`, `--it-border` |
| Input | `.admin-login-input`, `--it-input-bg`, 46px height, 10px radius |
| Primary CTA | `.btn-login`, `--it-gold` / `--it-gold-hover`, dark label text |
| Errors | `.admin-login-alert--error`, `--it-danger` |

No “Forgot password” link (no recovery workflow in repo).

## Reports (Phase 3)

- Reuses dashboard tokens, `.reportTabs`, `.exportMenu`, Chart.js via `admin-charts.js`.
- Filter drawer adds **category** and **payment method** fields.

## Dashboard (Phase 2)

- Layout: `.dashGrid` 12-column; KPI `.statCard`; charts in `.panel__body--chart` (280px).
- Charts: Chart.js 4.x — revenue (gold line/area), subscriptions (info blue bars).
- Filters: `.filterDrawer` + shared `.input`/`.select`; URL query params (`preset`, `from`, `to`, `track`, `sub_status`, `tx_status`, `granularity`).
- KPI “Captured revenue” = `SUM(transactions.amount)` where status filter applies (default `captured`). Amounts stored in **paise**.

## Subscriptions (Phase 4)

- Page: `data-subscriptions` on `.page`; list-first layout matching Dashboard/Reports.
- Reuses `.statGrid`, `.filterDrawer`, `.table--dashboard`, `.reportTxPager`, `.dashEmpty`.
- Create/edit in right drawer (`subCreateDrawer` / `subEditDrawer`); row actions via `.rowMenu`.
- Client: `public/js/admin-subscriptions.js` (debounced search, lookups).

## Consistency checklist

Before marking a module done: same `.page` wrapper, `.pageHeader`, panel classes, table `.table`, filter drawer pattern, 12px radius, no page-local `<style>` blocks.
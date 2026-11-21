# Admin login — Phase 1 implementation

## Scope

Redesigned [views/login.ejs](../views/login.ejs) only; dashboard and other modules unchanged.

## Files

| File | Purpose |
|------|---------|
| [public/css/admin-login.css](../public/css/admin-login.css) | Login layout, inputs, gold CTA, alerts |
| [public/css/admin-tokens.css](../public/css/admin-tokens.css) | Shared tokens (`--it-input-bg`, border `#303640`) |
| [public/js/admin-login.js](../public/js/admin-login.js) | Client validation, show/hide password, submit loading |
| [middleware/adminLoginRateLimit.js](../middleware/adminLoginRateLimit.js) | Failed-attempt lockout (20 / 15 min per IP) |
| [routes/admin.js](../routes/admin.js) | Session `regenerate` on success, generic auth errors |

## Security notes

- No credentials in placeholders or defaults (autofill is browser/password-manager only).
- Same generic message for unknown email vs bad password.
- Login POST excluded from CSRF (pre-session) — unchanged.
- No forgot-password link (not implemented).

## Tests

- `GET /admin/login` — **PASS** with `RUN_INTEGRATION=1 npm run test:integration` (see [test/integration/admin-login.test.js](../test/integration/admin-login.test.js)).
- Client validation — manual / browser.

## Verify locally

1. Open `/admin/login` — brand header, card, gold button.
2. Submit empty form — inline errors.
3. Wrong password — single generic server alert.
4. Correct login — redirect `/admin/dashboard`, session regenerated.
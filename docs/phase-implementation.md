# PureHub Phase Implementation Notes

## Implemented Foundation

- Added formal platform rules in `lib/platform-config.ts`.
- Added `/api/health` for Web/API, DB, Redis, locale, payment-provider, and version visibility.
- Added `/api/platform/rules` so frontend/admin screens can consume content duration, sale mode, USDT, payment, locale, and admin-role constraints from one source.
- Added a worker health stub for media, payments, analytics, and moderation queues.
- Added Docker Compose deployment for Ubuntu 24.04 with Web/API, worker, PostgreSQL, Redis, and Nginx.
- Added server scripts for deploy, rollback, healthcheck, and smoke testing.

## Phase 1 Ready Criteria

- Replace localStorage demo persistence with API-backed persistence.
- Add migrations and seed data once the database ORM is selected.
- Keep the current demo flows passing while changing the backing store.
- Deploy to staging with `./scripts/deploy.sh staging` and complete the server acceptance template.

## Phase 2 Ready Criteria

- Use `classifyMediaByDuration` and `isSaleModeAllowed` as the shared rule source for upload validation.
- Add object storage config and media worker implementation.
- Add creator application state and approval workflow.

## Phase 3 Ready Criteria

- Use `ADMIN_ROLE_LABELS` as the initial admin role list.
- Add audit log tables before allowing price, payment, or account changes from the admin UI.
- Version all price-tier changes.

## Phase 4 Ready Criteria

- Build payment adapters around the `PAYMENT_PROVIDERS` keys.
- Keep USDT as a payment provider only; the platform ledger remains the business source of truth.
- Make webhook and chain-monitor handlers idempotent before enabling production payment channels.

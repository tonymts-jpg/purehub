# Account Hub, Trending, and Admin Staging Handoff

Updated: 2026-08-03

## Release identity

- Branch: `feat/account-hub-trending-admin`
- Task 12 starting feature commit: `666550554d2ef08a40cdbfd15c1531ba673668be`
- Locally verified feature/repair commit: `dc81104af932f0018eef97ab48d88a7e6ef1cab8`
- Handoff commit: the commit containing this document, with message
  `docs: hand off account hub staging acceptance`
- Migration: `prisma/migrations/20260730000000_account_hub`
- Scope completed here: Task 12 steps 1-6 only. No push, merge, SSH, deployment,
  staging data reset, or deployed acceptance was performed.

## Exact local evidence

All commands ran in the linked worktree on the branch above.

- `npm run db:generate`: exit `0` (6.5 seconds wall time).
- Focused desktop suite:
  `npx playwright test tests/account-hub-data.spec.ts tests/account-hub-api.spec.ts tests/account-hub-ui.spec.ts tests/admin-information-architecture.spec.ts --project=desktop --workers=1`:
  `60 passed`, `31 skipped`, `0 failed` (3.4 minutes; 207.4 seconds wall time).
- Canonical complete suite, `npm run test:e2e`, with `workers: 1`:
  `264 passed`, `190 skipped`, `0 failed` (`454` total; 13.5 minutes,
  810 seconds wall time).
- Fresh post-suite `npm run lint`: exit `0` (14.0 seconds).
- Fresh post-suite `npx tsc --noEmit --incremental false`: exit `0`
  (26.8 seconds).
- Fresh post-suite `npm run build`: exit `0` (125.1 seconds), including all
  `36/36` static pages.

The local host intentionally had no `DATABASE_URL`, so the suite emitted Prisma
connection diagnostics and exercised the repository's explicit database skip
gates. The successful exit and the counts above do not replace database-backed
staging acceptance. The build also warned about Better Auth's default secret;
staging must supply a real `BETTER_AUTH_SECRET`.

## Repairs included in `dc81104`

- Moved audit cursor helpers out of the Next.js route module so the production
  route exports only supported handlers.
- Wrapped the favorites search-parameter consumer in `Suspense` for static
  production rendering.
- Restored the mobile guest creator entry and kept the compact mobile account
  navigation accessible and unambiguous.
- Set the canonical Playwright worker policy to one. Three full two-worker runs
  produced rotating shared-session/load failures; every last observed failure
  passed unchanged in isolation with one worker, and the final one-worker full
  suite passed.
- Set the Playwright local web server phase to `phase-7`, lengthened the global
  assertion timeout for the loaded full suite, and tightened one ambiguous
  creator-status locator without weakening its assertion.

## Database-backed cases required on staging

The deployed run must execute the complete suite against seeded PostgreSQL and
must not accept the local skip total as deployed evidence. In particular, the
31 focused database-gated project cases cover:

- session-owned account likes, follows, unlocks, orders, favorites, history,
  identity-override rejection, ACL-visible pagination, timestamp preservation,
  the exact 90-day retention boundary, and account maintenance;
- seeded fan/creator/mobile account navigation plus public/private/stale and
  hydration-sensitive channel favorite detail behavior;
- hot-post ranking against persisted views;
- direct admin authorization with `x-admin-role` ignored, content permissions,
  paid-visibility moderation history, missing-history rejection, atomic member
  mutation/audit, and protection of every `AdminAccount` target;
- authenticated overview/domain/support pages, audit cursor pagination beyond
  100 tied rows, finance repository semantics, finance/settings/audit tabs,
  finance and analyst role limits, and protected finance error states.

The remaining pre-existing full-suite database gates from earlier phases must
also run on staging. A deployed run is acceptable only with zero unexpected
failures and no skips caused by a missing database, missing seed, or missing
staging credentials.

## Required staging environment

Keep `.env.staging` server-side and ensure each key appears once. At minimum:

- `NODE_ENV=production`, `APP_ENV=staging`, `PUREHUB_PHASE=phase-7`,
  `NEXT_PUBLIC_DEMO_MODE=false`, the correct public/auth URLs, and the intended
  `HTTP_PORT`;
- real non-placeholder `BETTER_AUTH_SECRET` (at least 32 characters),
  `DEMO_ACCOUNT_PASSWORD`, `ADMIN_ACCESS_TOKEN`, `WORKER_ACCESS_TOKEN`,
  `POSTGRES_PASSWORD`, and `MINIO_ROOT_PASSWORD`;
- matching PostgreSQL (`POSTGRES_DB`, `POSTGRES_USER`, `DATABASE_URL`, host and
  port), Redis, MinIO/object-storage bucket and region, image, registry, and any
  enabled payment-provider configuration;
- `SERVICE_ADMIN_USER_ID=admin-demo`; set secure-cookie and public URL values to
  match the actual staging transport. Do not commit secrets.

## Deployment and health commands

After the authorized primary operator has pushed/merged the verified commit and
checked out that exact SHA on the Ubuntu staging host:

```bash
cd /var/www/purehub
git config core.fileMode false
git pull --ff-only
git rev-parse HEAD
chmod +x scripts/*.sh
DEPLOY_SEED=true ./scripts/deploy.sh staging
docker compose --env-file .env.staging ps
./scripts/healthcheck.sh staging
curl -fsS http://127.0.0.1/api/health
SMOKE_BASE_URL=http://127.0.0.1 ./scripts/smoke-test.sh
```

`scripts/deploy.sh staging` applies `npm run db:migrate`; confirm the migration
above is present before acceptance. Use `DEPLOY_SEED=true` only for the approved
staging seed/reset flow, never production.

If the host lacks acceptance dependencies:

```bash
npm ci --registry=https://registry.npmmirror.com/
npx playwright install --with-deps chromium
export PLAYWRIGHT_BASE_URL=http://127.0.0.1
export ADMIN_ACCESS_TOKEN="$(grep '^ADMIN_ACCESS_TOKEN=' .env.staging | tail -1 | cut -d= -f2-)"
export DEMO_ACCOUNT_PASSWORD="$(grep '^DEMO_ACCOUNT_PASSWORD=' .env.staging | tail -1 | cut -d= -f2-)"
npm run test:e2e:deployed
```

The deployed Playwright run is strictly one worker. `playwright.config.ts` now
defaults to `workers: 1`; if invoking Playwright directly, retain
`npx playwright test --workers=1`.

## Rollback

The repository rollback script restores the last available local image and then
runs the health check:

```bash
cd /var/www/purehub
./scripts/rollback.sh staging
docker compose --env-file .env.staging ps
curl -fsS http://127.0.0.1/api/health
```

If the web container is healthy but Nginx returns `502`, restart only Nginx and
recheck health:

```bash
docker compose --env-file .env.staging restart nginx
curl -fsS http://127.0.0.1/api/health
```

## Deployed acceptance placeholder

- Deployed commit SHA: pending authorized push/deploy.
- Migration status: pending staging verification.
- Service health: pending.
- Smoke result: pending.
- Deployed Playwright totals (`workers=1`): pending.
- Approved staging seed reset and final public health recheck: pending.

## Protected files

`README.md`, `start-local-demo.cmd`, all `.env*` files, secrets, and
`progress.md` were left untouched and were not staged or committed during this
Task 12 local pass.

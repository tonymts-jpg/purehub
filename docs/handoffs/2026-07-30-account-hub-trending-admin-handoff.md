# Account Hub, Trending, and Admin Staging Handoff

Updated: 2026-08-03

## Release identity

- Branch: `feat/account-hub-trending-admin`
- Task 12 starting feature commit: `666550554d2ef08a40cdbfd15c1531ba673668be`
- Locally verified feature/repair commit: `dc81104af932f0018eef97ab48d88a7e6ef1cab8`
- Initial handoff commit: `e8f953c20a1ab29a158cf34dd08a586a40a312ef`
- Corrected handoff commit: the commit containing this revision, with message
  `docs: correct account hub staging runbook`
- Final broad-review hardening commit: the commit containing the final-fix report
  and this revision.
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

## Final broad-review hardening (2026-08-03)

- Canonical public/account post visibility is now exactly `free`, `members`, and
  `purchase`; hidden, unpublished, pending, and removed records fail closed in
  public, creator, direct-detail, media, favorites, likes, history, and unlocked
  surfaces even when old entitlement rows exist.
- Favorites and unlocked responses include the database creator plus canonical
  occurrence timestamps, and their cards render that creator directly.
- Public and admin sign-in callbacks share a same-origin path sanitizer.
- Deploy smoke tests authenticate a seeded administrator through Better Auth and
  a temporary loopback-only cookie jar; the admin token bypass was removed from
  Compose, environment defaults, scripts, and the current acceptance runbook.
- Every state-changing admin route is inventoried. All newly covered finance
  actions and the five previously split admin settings flows now use atomic
  mutation-plus-audit transactions through the rollback-tested shared helper.

Final local evidence after these changes:

- canonical production-server desktop focus: `73 passed`, `34 expected local
  database/mobile skips`, `0 failed` (`107` total; 56.8 seconds);
- `npx tsc --noEmit --incremental false`: exit `0` (27.3 seconds);
- `npm run lint`: exit `0` (15.2 seconds);
- `npm run build`: exit `0` (143.1 seconds), including `36/36` static pages;
- `git diff --check`, deploy/smoke shell syntax, and Node smoke syntax: exit `0`.

The new moderated-content and audit rollback cases are PostgreSQL-gated and were
included in the 34 expected local skips. They must execute with zero unexpected
skips on seeded staging. Detailed evidence is in
`.superpowers/sdd/2026-07-30-account-hub-trending-admin/final-fix-1-report.md`.

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
must not accept the local skip total as deployed evidence. Of the focused
desktop suite's 31 skips, 29 were database-gated and two were intentionally
mobile-project-only cases. The 29 focused database-gated cases cover:

- session-owned account likes, follows, unlocks, orders, favorites, history,
  identity-override rejection, ACL-visible pagination, timestamp preservation,
  the exact 90-day retention boundary, and account maintenance;
- seeded fan and creator account navigation plus public/private/stale and
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
  `DEMO_ACCOUNT_PASSWORD`, `SMOKE_ADMIN_EMAIL`, `SMOKE_ADMIN_PASSWORD`, `WORKER_ACCESS_TOKEN`,
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
PREVIOUS_SHA="$(git rev-parse HEAD)"
printf 'Record this pre-deploy SHA for rollback: %s\n' "${PREVIOUS_SHA}"
git pull --ff-only
git rev-parse HEAD
chmod +x scripts/*.sh
DEPLOY_SEED=true ./scripts/deploy.sh staging
docker compose --env-file .env.staging ps
./scripts/healthcheck.sh staging
```

`scripts/deploy.sh staging` applies `npm run db:migrate`; confirm the migration
above is present before acceptance. Use `DEPLOY_SEED=true` only for the approved
staging seed/reset flow, never production.

If the host lacks acceptance dependencies:

```bash
npm ci --registry=https://registry.npmmirror.com/
npx playwright install --with-deps chromium
export DEMO_ACCOUNT_PASSWORD="$(grep '^DEMO_ACCOUNT_PASSWORD=' .env.staging | tail -1 | cut -d= -f2-)"
```

For host-local acceptance, derive the URL from the existing staging environment
instead of assuming port 80:

```bash
HTTP_PORT_VALUE="$(grep -E '^HTTP_PORT=' .env.staging | tail -1 | cut -d= -f2-)"
case "${HTTP_PORT_VALUE}" in ''|*[!0-9]*) echo 'Invalid HTTP_PORT in .env.staging' >&2; exit 1;; esac
export PLAYWRIGHT_BASE_URL="http://127.0.0.1:${HTTP_PORT_VALUE}"
npm run test:e2e:deployed
```

For the public deployed acceptance required by the implementation plan, use
`PLAYWRIGHT_BASE_URL=http://183.6.3.174:99` and retain one worker.

The deployed Playwright run is strictly one worker. `playwright.config.ts` now
defaults to `workers: 1`; if invoking Playwright directly, retain
`npx playwright test --workers=1`.

## Rollback

Before deployment, record the exact `PREVIOUS_SHA` as shown above outside the
transient shell and retain the corresponding database backup/snapshot. An app
rollback must explicitly select that SHA, rebuild it, and verify it; do not run
these commands unless rollback has been authorized:

```bash
cd /var/www/purehub
PREVIOUS_SHA='<recorded-pre-deploy-40-character-sha>'
git status --short
git cat-file -e "${PREVIOUS_SHA}^{commit}"
git switch --detach "${PREVIOUS_SHA}"
DEPLOY_SEED=false ./scripts/deploy.sh staging
docker compose --env-file .env.staging ps
./scripts/healthcheck.sh staging
```

Proceed only if `git status --short` is clean and `PREVIOUS_SHA` matches the
recorded pre-deploy commit. `scripts/rollback.sh staging` is not an application
version rollback: it only starts the image tags selected by the current Compose
configuration without rebuilding, so it must not be used as proof that the
previous commit was restored.

Prisma migrations are forward-only in this flow. Before checking out the older
application, decide whether the migrated schema is forward-compatible with that
SHA. If it is not, use the approved database backup/manual restore procedure;
never invent or apply an unreviewed down migration. The app and database
rollback decisions must be recorded together.

If the web container is healthy but Nginx returns `502`, restart only Nginx and
run the authoritative port-aware health check:

```bash
docker compose --env-file .env.staging restart nginx
./scripts/healthcheck.sh staging
```

## Deployed acceptance placeholder

- Deployed commit SHA: pending authorized push/deploy.
- Migration status: pending staging verification.
- Service health: pending.
- Smoke result: pending.
- Deployed Playwright totals (`workers=1`): pending.
- Approved staging seed reset and final public health recheck: pending.

## Protected files

`README.md`, `start-local-demo.cmd`, real `.env.staging`/`.env.production` files,
secrets, and `progress.md` were left untouched. `.env.example` was intentionally
updated only to document the credentialed smoke account variables; it contains no
real credential.

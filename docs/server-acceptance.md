# PureHub Server Acceptance

This document turns each phase into a repeatable Ubuntu 24.04 staging or production acceptance loop.

## One-Time Ubuntu Setup

Install Docker Engine, Docker Compose, Git, curl, and a TLS reverse proxy if the server will terminate HTTPS outside the included Nginx container.

```bash
git clone <repo-url> purehub
cd purehub
cp .env.example .env.staging
cp .env.example .env.production
chmod +x scripts/*.sh
```

Edit `.env.staging` and `.env.production` on the server. Never commit those files.

## Deploy

```bash
./scripts/deploy.sh staging
```

The deploy script builds the image, starts Web/API, PostgreSQL, Redis, worker, and Nginx, runs health checks, then runs smoke tests.

## Rollback

```bash
./scripts/rollback.sh staging
```

Rollback recreates services from the last available local image and reruns health checks. For production, take a DB snapshot before migrations.

## Phase Acceptance Template

- Phase:
- Environment:
- Version / commit:
- Deployed at:
- Healthcheck result:
- Smoke test result:
- E2E result:
- Migration result:
- Known issues:
- Accepted by:
- Decision: continue / fix first

## Required Checks Per Phase

- `docker compose --env-file .env.staging ps` shows all services healthy.
- `curl http://127.0.0.1/api/health` returns `status: ok`.
- `curl http://127.0.0.1/worker-health` returns `status: ok`.
- `SMOKE_BASE_URL=http://127.0.0.1 ./scripts/smoke-test.sh` passes.
- `npm run test:e2e` passes before the build is promoted.
- Logs for the last 10 minutes contain no startup-level `uncaught`, `unhandled`, `fatal`, or `panic` errors.

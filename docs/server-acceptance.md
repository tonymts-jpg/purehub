# PureHub Server Acceptance

This document turns each phase into a repeatable Ubuntu 24.04 staging or production acceptance loop.

## One-Time Ubuntu Setup

Install Docker Engine, Docker Compose, Git, curl, and a TLS reverse proxy if the server will terminate HTTPS outside the included Nginx container.

For a fresh Ubuntu 24.04 server, install Docker first:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg git
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
newgrp docker
docker --version
docker compose version
```

If `newgrp docker` does not refresh permissions in your current SSH session, log out and log back in.

```bash
git clone <repo-url> purehub
cd purehub
cp .env.example .env.staging
cp .env.example .env.production
chmod +x scripts/*.sh
```

Edit `.env.staging` and `.env.production` on the server. Never commit those files.

If `npm ci` times out during Docker build, set a closer registry in `.env.staging`:

```bash
NPM_REGISTRY=https://registry.npmmirror.com/
```

Then rebuild:

```bash
./scripts/deploy.sh staging
```

For Phase 4 staging tests, make sure `.env.staging` includes a real `ADMIN_ACCESS_TOKEN` value. The deploy script passes it to the web container and uses it for the finance smoke check.

If Docker cannot resolve Docker Hub, for example `failed to resolve reference` or `lookup registry-1.docker.io on 127.0.0.53:53: i/o timeout`, configure Docker daemon DNS on the server:

```bash
sudo mkdir -p /etc/docker
printf '%s\n' \
  '{' \
  '  "dns": ["1.1.1.1", "8.8.8.8"]' \
  '}' | sudo tee /etc/docker/daemon.json
sudo systemctl restart docker
docker pull nginx:1.27-alpine
docker pull postgres:16-alpine
docker pull redis:7-alpine
./scripts/deploy.sh staging
```

## Deploy

Phase 5 requires these additional staging secrets before deployment:

```bash
WORKER_ACCESS_TOKEN=replace-with-a-long-random-token
MINIO_ROOT_USER=purehub-minio
MINIO_ROOT_PASSWORD=replace-with-a-long-random-password
OBJECT_STORAGE_BUCKET=purehub-media
OBJECT_STORAGE_REGION=us-east-1
PUREHUB_PHASE=phase-5
```

```bash
./scripts/deploy.sh staging
```

The deploy script builds the image, starts Web/API, PostgreSQL, Redis, MinIO, worker, and Nginx, runs health checks, then runs smoke tests.

For Phase 4 and later, the deploy script also runs Prisma migrations automatically after the containers start and before smoke tests run. To reset staging demo data after migrations, opt in explicitly:

```bash
DEPLOY_SEED=true ./scripts/deploy.sh staging
```

Do not use `DEPLOY_SEED=true` against production unless you intentionally want to replace seeded demo data.

For Phase 2 database milestones, deploy the containers first, then run migrations and seed inside the `web` container:

```bash
./scripts/deploy.sh staging
docker compose --env-file .env.staging exec web npm run db:migrate
docker compose --env-file .env.staging exec web npm run db:seed
./scripts/healthcheck.sh
SMOKE_BASE_URL=http://127.0.0.1 ./scripts/smoke-test.sh
```

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
- `/api/health` reports `objectStorage: ok`, and the one-shot `minio-init` service exits with code 0 after creating the private bucket.
- Finance smoke checks can read settlement configs and reconciliation runs with the staging admin token.
- `SMOKE_BASE_URL=http://127.0.0.1 ./scripts/smoke-test.sh` passes.
- `npm run test:e2e` passes before the build is promoted.
- Logs for the last 10 minutes contain no startup-level `uncaught`, `unhandled`, `fatal`, or `panic` errors.

On the Ubuntu server, install test dependencies before running Playwright directly on the deployed staging site:

```bash
npm ci
npx playwright install --with-deps chromium
PLAYWRIGHT_BASE_URL=http://127.0.0.1 npm run test:e2e:deployed
```

`PLAYWRIGHT_BASE_URL` tells Playwright to use the already deployed Docker service instead of starting a local Next.js dev server.

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

Phase 5 and later require these additional staging secrets before deployment:

```bash
WORKER_ACCESS_TOKEN=replace-with-a-long-random-token
MINIO_ROOT_USER=purehub-minio
MINIO_ROOT_PASSWORD=replace-with-a-long-random-password
OBJECT_STORAGE_BUCKET=purehub-media
OBJECT_STORAGE_REGION=us-east-1
PUREHUB_PHASE=phase-7
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

## Phase 7 Staging Acceptance

Before deployment, confirm that `.env.staging` contains exactly one
`PUREHUB_PHASE=phase-7` entry and real server-only values for
`BETTER_AUTH_SECRET`, `DEMO_ACCOUNT_PASSWORD`, `ADMIN_ACCESS_TOKEN`,
`WORKER_ACCESS_TOKEN`, `POSTGRES_PASSWORD`, and `MINIO_ROOT_PASSWORD`. Never
commit or print those values.

Deploy from the intended commit, run migrations, and opt in to the repeatable
staging seed:

```bash
cd /var/www/purehub
git config core.fileMode false
git pull --ff-only
chmod +x scripts/*.sh
DEPLOY_SEED=true ./scripts/deploy.sh staging
docker compose --env-file .env.staging ps
docker compose --env-file .env.staging exec web npm run db:migrate
docker compose --env-file .env.staging exec web npm run db:seed
curl -fsS http://127.0.0.1/api/health
curl -fsS http://127.0.0.1/worker-health
SMOKE_BASE_URL=http://127.0.0.1 ./scripts/smoke-test.sh
SMOKE_BASE_URL=http://127.0.0.1 npm run smoke
```

The web health response must report `phase-7` with `channels`, `channelAcl`,
and `postgresSearch` enabled. It must also report the exact 40-character Git
commit exported by `scripts/deploy.sh`. Worker health must include
`channelMaterialization` and `searchIndexing` queue/task state. Both smoke
runners verify the seeded public channel directory, typed creator search, and
the unauthenticated dashboard mutation boundary.

On the Ubuntu server, install test dependencies before running Playwright
directly on the deployed staging site:

```bash
npm ci --registry=https://registry.npmmirror.com/
npm run db:generate
npx playwright install --with-deps chromium
export PLAYWRIGHT_BASE_URL=http://127.0.0.1
export ADMIN_ACCESS_TOKEN="$(grep '^ADMIN_ACCESS_TOKEN=' .env.staging | tail -1 | cut -d= -f2-)"
export DEMO_ACCOUNT_PASSWORD="$(grep '^DEMO_ACCOUNT_PASSWORD=' .env.staging | tail -1 | cut -d= -f2-)"
export WORKER_ACCESS_TOKEN="$(grep '^WORKER_ACCESS_TOKEN=' .env.staging | tail -1 | cut -d= -f2-)"
runtime_database_url="$(docker compose --env-file .env.staging exec -T web printenv DATABASE_URL)"
postgres_container_id="$(docker compose --env-file .env.staging ps -q postgres)"
postgres_container_ip="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "${postgres_container_id}")"
runtime_object_storage_endpoint="$(docker compose --env-file .env.staging exec -T web printenv OBJECT_STORAGE_ENDPOINT)"
minio_container_id="$(docker compose --env-file .env.staging ps -q minio)"
minio_container_ip="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "${minio_container_id}")"
test -n "${postgres_container_ip}"
test -n "${minio_container_ip}"
export DATABASE_URL="${runtime_database_url/@postgres:/@${postgres_container_ip}:}"
export OBJECT_STORAGE_ENDPOINT="http://${minio_container_ip}:${runtime_object_storage_endpoint##*:}"
export OBJECT_STORAGE_ACCESS_KEY="$(docker compose --env-file .env.staging exec -T web printenv OBJECT_STORAGE_ACCESS_KEY)"
export OBJECT_STORAGE_SECRET_KEY="$(docker compose --env-file .env.staging exec -T web printenv OBJECT_STORAGE_SECRET_KEY)"
export OBJECT_STORAGE_BUCKET="$(docker compose --env-file .env.staging exec -T web printenv OBJECT_STORAGE_BUCKET)"
export OBJECT_STORAGE_REGION="$(docker compose --env-file .env.staging exec -T web printenv OBJECT_STORAGE_REGION)"
export OBJECT_STORAGE_FORCE_PATH_STYLE="$(docker compose --env-file .env.staging exec -T web printenv OBJECT_STORAGE_FORCE_PATH_STYLE)"
npm run test:e2e:deployed
unset ADMIN_ACCESS_TOKEN DEMO_ACCOUNT_PASSWORD WORKER_ACCESS_TOKEN DATABASE_URL runtime_database_url
unset OBJECT_STORAGE_ENDPOINT OBJECT_STORAGE_ACCESS_KEY OBJECT_STORAGE_SECRET_KEY
unset OBJECT_STORAGE_BUCKET OBJECT_STORAGE_REGION OBJECT_STORAGE_FORCE_PATH_STYLE runtime_object_storage_endpoint
```

`PLAYWRIGHT_BASE_URL` tells Playwright to use the already deployed Docker service instead of starting a local Next.js dev server.
The host-side `DATABASE_URL` uses PostgreSQL's private Docker bridge address so
database-gated tests can run without publishing the database port.
The object-storage variables use MinIO's private Docker bridge address so the
acceptance cleanup can remove and verify its exact original and derivative
object keys without publishing MinIO or persisting credentials.
The deployed Playwright configuration uses one worker. Every Phase 7
database-gated lifecycle, ACL, membership, curation/concurrency,
search/reindex, UI, cleanup, and entitlement-isolation test must execute with
zero unexpected skips or failures.

Record and compare the local checkout, GitHub, staging checkout, and runtime
commit:

```bash
local_sha="$(git rev-parse HEAD)"
github_sha="$(git ls-remote origin refs/heads/main | cut -f1)"
runtime_sha="$(curl -fsS http://127.0.0.1/api/health | node -e \
  "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>process.stdout.write(JSON.parse(s).commit))")"
test "${local_sha}" = "${github_sha}"
test "${local_sha}" = "${runtime_sha}"
```

Also record `/api/health` phase/version, Docker service state, migration and
seed results, both smoke results, and exact Playwright passed/skipped/failed
totals. Local, GitHub, staging checkout, and runtime commit SHAs must match
before Phase 7 is accepted. A runtime value of `unknown` fails staging
acceptance.

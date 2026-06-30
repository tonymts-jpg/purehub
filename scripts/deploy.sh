#!/usr/bin/env bash
set -euo pipefail

ENVIRONMENT="${1:-staging}"
ENV_FILE=".env.${ENVIRONMENT}"

if [ ! -f "${ENV_FILE}" ]; then
  echo "Missing ${ENV_FILE}. Create it from .env.example on the server." >&2
  exit 1
fi

echo "Deploying PureHub ${ENVIRONMENT}"
docker compose --env-file "${ENV_FILE}" build
docker compose --env-file "${ENV_FILE}" up -d --remove-orphans

echo "Waiting for services to become healthy"
./scripts/healthcheck.sh "${ENVIRONMENT}"

echo "Running smoke tests"
SMOKE_BASE_URL="${SMOKE_BASE_URL:-http://127.0.0.1:${HTTP_PORT:-80}}" ./scripts/smoke-test.sh

echo "Deployment complete"

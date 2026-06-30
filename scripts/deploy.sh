#!/usr/bin/env bash
set -euo pipefail

ENVIRONMENT="${1:-staging}"
ENV_FILE=".env.${ENVIRONMENT}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "${SCRIPT_DIR}/preflight.sh"

if [ ! -f "${ENV_FILE}" ]; then
  echo "Missing ${ENV_FILE}. Create it from .env.example on the server." >&2
  exit 1
fi

echo "Deploying PureHub ${ENVIRONMENT}"
docker compose --env-file "${ENV_FILE}" build
docker compose --env-file "${ENV_FILE}" up -d --remove-orphans

echo "Waiting for services to become healthy"
bash "${SCRIPT_DIR}/healthcheck.sh" "${ENVIRONMENT}"

echo "Running smoke tests"
SMOKE_BASE_URL="${SMOKE_BASE_URL:-http://127.0.0.1:${HTTP_PORT:-80}}" bash "${SCRIPT_DIR}/smoke-test.sh"

echo "Deployment complete"

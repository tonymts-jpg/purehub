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

retry() {
  local attempts="$1"
  local delay_seconds="$2"
  shift 2

  local attempt=1
  until "$@"; do
    if [ "${attempt}" -ge "${attempts}" ]; then
      echo "Command failed after ${attempts} attempts: $*" >&2
      return 1
    fi
    echo "Attempt ${attempt}/${attempts} failed. Retrying in ${delay_seconds}s: $*" >&2
    sleep "${delay_seconds}"
    attempt=$((attempt + 1))
  done
}

echo "Deploying PureHub ${ENVIRONMENT}"
echo "Pulling runtime images"
retry 3 15 docker compose --env-file "${ENV_FILE}" pull postgres redis nginx minio minio-init
retry 2 20 docker compose --env-file "${ENV_FILE}" build
retry 3 15 docker compose --env-file "${ENV_FILE}" up -d --remove-orphans

echo "Running database migrations"
retry 3 10 docker compose --env-file "${ENV_FILE}" exec -T web npm run db:migrate

if [ "${DEPLOY_SEED:-false}" = "true" ]; then
  echo "Seeding database because DEPLOY_SEED=true"
  docker compose --env-file "${ENV_FILE}" exec -T web npm run db:seed
fi

echo "Waiting for services to become healthy"
bash "${SCRIPT_DIR}/healthcheck.sh" "${ENVIRONMENT}"

echo "Running smoke tests"
HTTP_PORT_VALUE="$(grep -E '^HTTP_PORT=' "${ENV_FILE}" | tail -1 | cut -d= -f2-)"
HTTP_PORT_VALUE="${HTTP_PORT_VALUE:-80}"
ADMIN_ACCESS_TOKEN_VALUE="$(grep -E '^ADMIN_ACCESS_TOKEN=' "${ENV_FILE}" | tail -1 | cut -d= -f2-)"
SMOKE_ADMIN_TOKEN="${SMOKE_ADMIN_TOKEN:-${ADMIN_ACCESS_TOKEN_VALUE}}" SMOKE_BASE_URL="${SMOKE_BASE_URL:-http://127.0.0.1:${HTTP_PORT_VALUE}}" bash "${SCRIPT_DIR}/smoke-test.sh"

echo "Deployment complete"

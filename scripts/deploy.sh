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
retry 3 15 docker compose --env-file "${ENV_FILE}" pull postgres redis nginx
retry 2 20 docker compose --env-file "${ENV_FILE}" build
retry 3 15 docker compose --env-file "${ENV_FILE}" up -d --remove-orphans

echo "Waiting for services to become healthy"
bash "${SCRIPT_DIR}/healthcheck.sh" "${ENVIRONMENT}"

echo "Running smoke tests"
SMOKE_BASE_URL="${SMOKE_BASE_URL:-http://127.0.0.1:${HTTP_PORT:-80}}" bash "${SCRIPT_DIR}/smoke-test.sh"

echo "Deployment complete"

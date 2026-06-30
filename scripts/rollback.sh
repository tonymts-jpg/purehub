#!/usr/bin/env bash
set -euo pipefail

ENVIRONMENT="${1:-staging}"
ENV_FILE=".env.${ENVIRONMENT}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "${SCRIPT_DIR}/preflight.sh"

if [ ! -f "${ENV_FILE}" ]; then
  echo "Missing ${ENV_FILE}. Cannot rollback." >&2
  exit 1
fi

echo "Rolling PureHub ${ENVIRONMENT} back to the last available local image"
docker compose --env-file "${ENV_FILE}" up -d --no-build --remove-orphans
bash "${SCRIPT_DIR}/healthcheck.sh" "${ENVIRONMENT}"

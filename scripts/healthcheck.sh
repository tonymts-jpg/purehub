#!/usr/bin/env bash
set -euo pipefail

ENVIRONMENT="${1:-staging}"
ENV_FILE=".env.${ENVIRONMENT}"

if [ ! -f "${ENV_FILE}" ]; then
  echo "Missing ${ENV_FILE}. Create it from .env.example on the server." >&2
  exit 1
fi

HTTP_PORT_VALUE="$(grep -E '^HTTP_PORT=' "${ENV_FILE}" | tail -1 | cut -d= -f2-)"
HTTP_PORT_VALUE="${HTTP_PORT_VALUE:-80}"

docker compose --env-file "${ENV_FILE}" ps

echo "Checking nginx"
curl --fail --silent --show-error "http://127.0.0.1:${HTTP_PORT_VALUE}/healthz" >/dev/null

echo "Checking web/API"
curl --fail --silent --show-error "http://127.0.0.1:${HTTP_PORT_VALUE}/api/health" >/dev/null

echo "Checking worker"
curl --fail --silent --show-error "http://127.0.0.1:${HTTP_PORT_VALUE}/worker-health" >/dev/null

echo "Checking logs for startup errors"
if docker compose --env-file "${ENV_FILE}" logs --since=10m | grep -Ei "uncaught|unhandled|fatal|panic" >/dev/null; then
  echo "Recent logs contain startup errors." >&2
  exit 1
fi

echo "PureHub ${ENVIRONMENT} healthcheck passed"

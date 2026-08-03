#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${SMOKE_BASE_URL:-http://127.0.0.1:80}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! node "${SCRIPT_DIR}/smoke-test.mjs" validate-base-url "${BASE_URL}"; then
  echo "SMOKE_BASE_URL must be an HTTP(S) loopback origin" >&2
  exit 1
fi
COOKIE_JAR="$(mktemp)"
AUTH_BODY="$(mktemp)"
trap 'rm -f "${COOKIE_JAR}" "${AUTH_BODY}"' EXIT

check_url() {
  local name="$1"
  local path="$2"
  echo "Checking ${name}: ${BASE_URL}${path}"
  curl --fail --silent --show-error "${BASE_URL}${path}" >/dev/null
}

check_json() {
  local name="$1"
  local path="$2"
  local validator="$3"
  echo "Checking ${name}: ${BASE_URL}${path}"
  curl --fail --silent --show-error "${BASE_URL}${path}" \
    | node "${SCRIPT_DIR}/smoke-test.mjs" validate-json "${validator}" >/dev/null
}

check_url "home" "/"
check_url "explore" "/explore"
check_url "post detail" "/post/post-1"
check_url "platform rules" "/api/platform/rules"

check_json "Phase 7 health and capabilities" "/api/health" "health"
check_json "seeded public channels" "/api/channels" "channels"
check_json "typed creator search" "/api/search?q=yuki&type=creator" "creator-search"

echo "Checking unauthenticated identity boundary"
test "$(curl --silent --output /dev/null --write-out '%{http_code}' "${BASE_URL}/api/me")" = "401"

echo "Checking unauthenticated dashboard channel mutation"
test "$(curl --silent --output /dev/null --write-out '%{http_code}' \
  --request POST \
  --header 'content-type: application/json' \
  --data '{}' \
  "${BASE_URL}/api/dashboard/channels")" = "401"

: "${SMOKE_ADMIN_EMAIL:?SMOKE_ADMIN_EMAIL is required}"
: "${SMOKE_ADMIN_PASSWORD:?SMOKE_ADMIN_PASSWORD is required}"

SMOKE_ADMIN_EMAIL="${SMOKE_ADMIN_EMAIL}" SMOKE_ADMIN_PASSWORD="${SMOKE_ADMIN_PASSWORD}" \
  node -e 'process.stdout.write(JSON.stringify({email:process.env.SMOKE_ADMIN_EMAIL,password:process.env.SMOKE_ADMIN_PASSWORD}))' \
  >"${AUTH_BODY}"

echo "Signing in the staging smoke administrator"
AUTH_STATUS="$(curl --silent --show-error \
  --output /dev/null \
  --write-out '%{http_code}' \
  --request POST \
  --header 'content-type: application/json' \
  --header "origin: ${BASE_URL}" \
  --cookie-jar "${COOKIE_JAR}" \
  --data-binary "@${AUTH_BODY}" \
  "${BASE_URL}/api/auth/sign-in/email")"
test "${AUTH_STATUS}" = "200"
test -s "${COOKIE_JAR}"

echo "Checking finance fee configs: ${BASE_URL}/api/admin/finance/fee-configs"
curl --fail --silent --show-error --cookie "${COOKIE_JAR}" \
  "${BASE_URL}/api/admin/finance/fee-configs" >/dev/null
echo "Checking Phase 5 settlement configs and reconciliation"
curl --fail --silent --show-error --cookie "${COOKIE_JAR}" \
  "${BASE_URL}/api/admin/finance/settlement-configs" >/dev/null
curl --fail --silent --show-error --cookie "${COOKIE_JAR}" \
  "${BASE_URL}/api/admin/finance/reconciliation" >/dev/null

echo "Smoke tests passed"

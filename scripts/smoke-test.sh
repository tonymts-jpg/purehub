#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${SMOKE_BASE_URL:-http://127.0.0.1:80}"

check_url() {
  local name="$1"
  local path="$2"
  echo "Checking ${name}: ${BASE_URL}${path}"
  curl --fail --silent --show-error "${BASE_URL}${path}" >/dev/null
}

check_url "home" "/"
check_url "explore" "/explore"
check_url "post detail" "/post/post-1"
check_url "platform rules" "/api/platform/rules"

echo "Checking Phase 7 health and capabilities"
health_body="$(curl --fail --silent --show-error "${BASE_URL}/api/health")"
printf '%s' "${health_body}" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"'
printf '%s' "${health_body}" | grep -Eq '"phase"[[:space:]]*:[[:space:]]*"phase-7"'
printf '%s' "${health_body}" | grep -Eq '"channels"[[:space:]]*:[[:space:]]*true'
printf '%s' "${health_body}" | grep -Eq '"channelAcl"[[:space:]]*:[[:space:]]*true'
printf '%s' "${health_body}" | grep -Eq '"postgresSearch"[[:space:]]*:[[:space:]]*true'

echo "Checking seeded public channels"
channels_body="$(curl --fail --silent --show-error "${BASE_URL}/api/channels")"
printf '%s' "${channels_body}" | grep -Eq '"channels"[[:space:]]*:[[:space:]]*\['

echo "Checking typed creator search"
search_body="$(curl --fail --silent --show-error "${BASE_URL}/api/search?q=yuki&type=creator")"
printf '%s' "${search_body}" | grep -Eq '"results"[[:space:]]*:[[:space:]]*\['

echo "Checking unauthenticated identity boundary"
test "$(curl --silent --output /dev/null --write-out '%{http_code}' "${BASE_URL}/api/me")" = "401"

echo "Checking unauthenticated dashboard channel mutation"
test "$(curl --silent --output /dev/null --write-out '%{http_code}' \
  --request POST \
  --header 'content-type: application/json' \
  --data '{}' \
  "${BASE_URL}/api/dashboard/channels")" = "401"

if [ -n "${SMOKE_ADMIN_TOKEN:-}" ]; then
  echo "Checking finance fee configs: ${BASE_URL}/api/admin/finance/fee-configs"
  curl --fail --silent --show-error \
    -H "x-admin-token: ${SMOKE_ADMIN_TOKEN}" \
    "${BASE_URL}/api/admin/finance/fee-configs" >/dev/null
  echo "Checking Phase 5 settlement configs and reconciliation"
  curl --fail --silent --show-error -H "x-admin-token: ${SMOKE_ADMIN_TOKEN}" "${BASE_URL}/api/admin/finance/settlement-configs" >/dev/null
  curl --fail --silent --show-error -H "x-admin-token: ${SMOKE_ADMIN_TOKEN}" "${BASE_URL}/api/admin/finance/reconciliation" >/dev/null
else
  echo "Skipping finance fee configs smoke check: SMOKE_ADMIN_TOKEN is not configured"
fi

echo "Smoke tests passed"

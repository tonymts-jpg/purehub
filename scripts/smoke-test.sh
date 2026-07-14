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
check_url "health" "/api/health"
check_url "platform rules" "/api/platform/rules"

if [ -n "${SMOKE_ADMIN_TOKEN:-}" ]; then
  echo "Checking finance fee configs: ${BASE_URL}/api/admin/finance/fee-configs"
  curl --fail --silent --show-error \
    -H "x-admin-token: ${SMOKE_ADMIN_TOKEN}" \
    -H "x-admin-role: finance_admin" \
    "${BASE_URL}/api/admin/finance/fee-configs" >/dev/null
  echo "Checking Phase 5 settlement configs and reconciliation"
  curl --fail --silent --show-error -H "x-admin-token: ${SMOKE_ADMIN_TOKEN}" -H "x-admin-role: finance_admin" "${BASE_URL}/api/admin/finance/settlement-configs" >/dev/null
  curl --fail --silent --show-error -H "x-admin-token: ${SMOKE_ADMIN_TOKEN}" -H "x-admin-role: finance_admin" "${BASE_URL}/api/admin/finance/reconciliation" >/dev/null
else
  echo "Skipping finance fee configs smoke check: SMOKE_ADMIN_TOKEN is not configured"
fi

echo "Smoke tests passed"

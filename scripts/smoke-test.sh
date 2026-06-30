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

echo "Smoke tests passed"

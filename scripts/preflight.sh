#!/usr/bin/env bash
set -euo pipefail

require_command() {
  local name="$1"
  local install_hint="$2"

  if ! command -v "${name}" >/dev/null 2>&1; then
    echo "Missing required command: ${name}" >&2
    echo "${install_hint}" >&2
    exit 127
  fi
}

require_docker_compose() {
  require_command "docker" "Install Docker Engine on Ubuntu 24.04, then rerun this script. See docs/server-acceptance.md."

  if ! docker compose version >/dev/null 2>&1; then
    echo "Docker is installed, but 'docker compose' is not available." >&2
    echo "Install the Docker Compose plugin on Ubuntu 24.04, then rerun this script." >&2
    exit 127
  fi
}

require_command "curl" "Install curl with: sudo apt-get update && sudo apt-get install -y curl"
require_docker_compose

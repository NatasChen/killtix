#!/usr/bin/env bash
# Browser E2E test (Playwright in Docker, no local browser needed) against a running TicketDesk.
#   usage: scripts/ui-e2e.sh <base-url> <super-admin-password> [admin-email]
# The admin must already have changed the bootstrap password (e.g. run scripts/smoke.sh first).
# Creates test data; use a test environment. Screenshots land in tests/e2e/shots/.
set -euo pipefail
cd "$(dirname "$0")/.."
BASE=${1:?base url, e.g. http://localhost:8080}
PASSWORD=${2:?super admin password}
EMAIL=${3:-admin@ticket.local}
PLAYWRIGHT=1.52.0
mkdir -p tests/e2e/shots
docker run --rm --network host \
  -e BASE_URL="$BASE" -e ADMIN_EMAIL="$EMAIL" -e ADMIN_PASSWORD="$PASSWORD" -e SHOTS_DIR=/shots \
  -v "$PWD/tests/e2e/ui.mjs:/opt/e2e/ui.mjs:ro" -v "$PWD/tests/e2e/shots:/shots" \
  "mcr.microsoft.com/playwright:v${PLAYWRIGHT}-noble" \
  bash -c "cd /opt/e2e && npm init -y >/dev/null && npm i --silent playwright@${PLAYWRIGHT} >/dev/null && node ui.mjs"

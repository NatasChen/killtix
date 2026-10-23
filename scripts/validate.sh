#!/usr/bin/env bash
# Deterministic quality gate used by CI and by the CrewAI generator after every run.
# Exits non-zero on the first failure; output is meant to be fed back to whoever must fix it.
set -euo pipefail
cd "$(dirname "$0")/.."
step() { printf '\n==> %s\n' "$*"; }

step "typecheck (server + web)"
npm run --silent typecheck

step "database migrations match src/server/db/schema.ts"
# Generate against a scratch copy of drizzle/ (relative path: drizzle-kit mishandles absolute --out)
# and require its explicit "no changes" message; anything else, including errors, fails.
rm -rf .drift-check && mkdir .drift-check && cp -r drizzle .drift-check/drizzle
trap 'rm -rf .drift-check' EXIT
drift=$(npx drizzle-kit generate --dialect postgresql --schema src/server/db/schema.ts --out .drift-check/drizzle 2>&1 || true)
if ! grep -q "No schema changes" <<<"$drift"; then
  echo "$drift" | tail -20 >&2
  echo "schema.ts and drizzle/ are out of sync. Run: npm run db:generate" >&2
  exit 1
fi

step "unit + integration tests"
npm test --silent

step "production build"
npm run --silent build >/dev/null

step "OpenAPI document is valid JSON"
node -e "JSON.parse(require('fs').readFileSync('docs/openapi.json','utf8'))"

step "relative links in Markdown point to existing files"
node scripts/check-links.mjs

if command -v docker >/dev/null && docker info >/dev/null 2>&1; then
  step "docker compose file is valid"
  APP_SECRET=x POSTGRES_PASSWORD=x REDIS_PASSWORD=x docker compose --env-file /dev/null config -q
else
  step "docker compose check skipped (docker not available)"
fi

printf '\nAll checks passed.\n'

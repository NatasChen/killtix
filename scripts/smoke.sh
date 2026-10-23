#!/usr/bin/env bash
# End-to-end smoke test against a running TicketDesk (e.g. docker compose).
#   usage: scripts/smoke.sh <base-url> <bootstrap-admin-password> [new-admin-password]
# Exercises: forced password change, ticket CRUD, API token + idempotent SOC ticket,
# 3-day filter, CSV export, security headers, SPA routing.
set -euo pipefail

BASE=${1:?base url, e.g. http://localhost:8080}
ADMIN_PW=${2:?bootstrap admin password}
NEW_PW=${3:-Smoke-Test-Passw0rd!}
JAR=$(mktemp)
trap 'rm -f "$JAR"' EXIT
pass=0
fail() { echo "FAIL: $*" >&2; exit 1; }
ok() { pass=$((pass + 1)); echo "ok   $*"; }
# check "<description>" <expected> <actual>
check() { [ "$3" = "$2" ] && ok "$1" || fail "$1 (expected '$2', got '$3')"; }
json() { python3 -c "import sys,json; d=json.load(sys.stdin); print(eval(sys.argv[1], {'d': d}))" "$1"; }
req() { # method path [body] -> prints "status body"
  local method=$1 path=$2 body=${3:-}
  curl -sS -o /tmp/smoke.$$ -w '%{http_code}' -b "$JAR" -c "$JAR" -X "$method" \
    -H 'Content-Type: application/json' -H 'X-Requested-With: XMLHttpRequest' \
    ${body:+--data "$body"} "$BASE/api/v1$path"
}
body() { cat /tmp/smoke.$$; }

check "healthz" ok "$(curl -sS "$BASE/healthz" | json "d['status']")"

headers=$(curl -sSI "$BASE/")
grep -qi '^content-security-policy:' <<<"$headers" && ok "CSP header present" || fail "no CSP header"
grep -qi '^x-frame-options:' <<<"$headers" && ok "X-Frame-Options present" || fail "no X-Frame-Options"
check "SPA deep link serves index.html" 200 "$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/tickets/TCK-1")"

check "wrong password rejected" 401 "$(req POST /auth/login '{"email":"admin@ticket.local","password":"wrong"}')"
code=$(req POST /auth/login "{\"email\":\"admin@ticket.local\",\"password\":\"$ADMIN_PW\"}")
[ "$code" = 200 ] || fail "bootstrap login: $code $(body)"
check "bootstrap admin gets restricted session" password_change "$(body | json "d['stage']")"
check "business API blocked before password change (status)" 403 "$(req GET /tickets)"
check "business API blocked before password change (code)" password_change_required "$(body | json "d['code']")"
check "weak password rejected" 400 "$(req POST /auth/change-password "{\"currentPassword\":\"$ADMIN_PW\",\"newPassword\":\"short\"}")"
code=$(req POST /auth/change-password "{\"currentPassword\":\"$ADMIN_PW\",\"newPassword\":\"$NEW_PW\"}")
check "password changed" 200 "$code"
check "full session after password change" full "$(body | json "d['stage']")"

code=$(req POST /tickets '{"subject":"Smoke: VPN down","description":"cannot connect","helpTopic":"general","priority":"high","tags":["vpn"]}')
[ "$code" = 201 ] || fail "create ticket: $code $(body)"
number=$(body | json "d['number']")
ok "ticket $number created"
check "internal note added" 201 "$(req POST "/tickets/$number/threads" '{"type":"internal_note","body":"internal smoke note"}')"
check "status → pending_user" 200 "$(req PATCH "/tickets/$number" '{"status":"pending_user"}')"
check "illegal transition → 409" 409 "$(req PATCH "/tickets/$number" '{"status":"new"}')"

code=$(req POST /admin/api-tokens '{"name":"smoke-soc","scopes":["tickets:write","tickets:read"]}')
[ "$code" = 201 ] || fail "create token: $code $(body)"
token=$(body | json "d['token']")
ok "API token created"
soc() {
  curl -sS -o /tmp/smoke.$$ -w '%{http_code}' -X POST -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
    -H 'Idempotency-Key: SMOKE-0001' --data '{"subject":"[SOC] smoke alert","helpTopic":"security-incident","priority":5,"requester":{"email":"soc@example.com"}}' \
    "$BASE/api/v1/tickets"
}
check "SOC ticket created via API" 201 "$(soc)"
first=$(body | json "d['id']")
check "idempotent replay status" 200 "$(soc)"
check "idempotent replay returns same ticket" "$first" "$(body | json "d['id']")"
check "token cannot reach admin API" 403 "$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $token" "$BASE/api/v1/admin/users")"

check "3-day filter query" 200 "$(req GET '/tickets?olderThanDays=3')"
check "dashboard" 200 "$(req GET /dashboard)"
check "dashboard counts both new tickets as open" 2 "$(body | json "d['openCount']")"
csv=$(curl -sS -b "$JAR" "$BASE/api/v1/reports/tickets.csv")
head -c3 <<<"$csv" | od -An -tx1 | grep -q 'ef bb bf' && ok "CSV export with UTF-8 BOM" || fail "CSV export"

echo "PASS: $pass checks"

#!/usr/bin/env bash
# CI smoke test for the API. Expects a migrated Postgres on 127.0.0.1:5432
# (see .github/workflows/ci.yml). Boots the real server and exercises the
# health check plus the register/login/session flow end to end.
set -euo pipefail

export DB_USER=${DB_USER:-postgres}
export DB_PASSWORD=${DB_PASSWORD:-postgres}
export DB_HOST=${DB_HOST:-127.0.0.1}
export DB_PORT=${DB_PORT:-5432}
export DB_NAME=${DB_NAME:-ONA}
export SESSION_SECRET=${SESSION_SECRET:-ci-smoke-secret}
export PORT=${PORT:-3000}

BASE="http://127.0.0.1:$PORT"
COOKIES=$(mktemp)

cleanup() {
  [ -n "${API_PID:-}" ] && kill "$API_PID" 2>/dev/null || true
  rm -f "$COOKIES"
}
trap cleanup EXIT

echo "==> Starting API"
node api/server.js &
API_PID=$!

echo "==> Waiting for health check"
for i in $(seq 1 30); do
  if curl -fsS "$BASE/health" >/dev/null 2>&1; then break; fi
  if ! kill -0 "$API_PID" 2>/dev/null; then
    echo "!! API process exited during startup" >&2
    exit 1
  fi
  sleep 1
done
HEALTH=$(curl -fsS "$BASE/health")
echo "health: $HEALTH"
echo "$HEALTH" | grep -q '"database":"ok"' || { echo "!! DB health check failed" >&2; exit 1; }

echo "==> Unauthenticated request is rejected"
STATUS=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/surveys")
[ "$STATUS" = "401" ] || { echo "!! expected 401 from /api/surveys, got $STATUS" >&2; exit 1; }

echo "==> Register"
curl -fsS -X POST "$BASE/api/register" \
  -H 'Content-Type: application/json' \
  -d '{"username":"ci-smoke","password":"ci-smoke-password"}' | grep -q '"success":true'

echo "==> Login"
curl -fsS -c "$COOKIES" -X POST "$BASE/api/login" \
  -H 'Content-Type: application/json' \
  -d '{"username":"ci-smoke","password":"ci-smoke-password"}' | grep -q '"success":true'

echo "==> Session survives (check-auth)"
curl -fsS -b "$COOKIES" "$BASE/api/check-auth" | grep -q '"isAuthenticated":true'

echo "==> Authenticated survey CRUD"
curl -fsS -b "$COOKIES" -X POST "$BASE/api/survey" \
  -H 'Content-Type: application/json' \
  -d '{"surveyName":"ci-smoke-survey"}' >/dev/null
curl -fsS -b "$COOKIES" "$BASE/api/surveys" | grep -q 'ci-smoke-survey'

echo "==> Smoke test passed"

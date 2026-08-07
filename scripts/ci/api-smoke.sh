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
export SURVEY_URL=${SURVEY_URL:-http://survey.example.test}
export RESEND_API_KEY=${RESEND_API_KEY:-ci-not-used-provider-key}
export EMAIL_WORKER_ENV=${EMAIL_WORKER_ENV:-test}
export SURVEY_DELIVERY_V2_ENABLED=true
export LEGACY_START_ENABLED=true

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

echo "==> Grant smoke user org membership"
node <<'NODE'
const { createRequire } = require('module');
const path = require('path');
const apiRequire = createRequire(path.resolve(process.cwd(), 'api/package.json'));
const { Pool } = apiRequire('pg');
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'ONA',
});
(async () => {
  await pool.query(`
    INSERT INTO organization_memberships (organization_id, user_id, role)
    SELECT o.id, u.id, 'owner'
    FROM organizations o
    JOIN users u ON u.username = 'ci-smoke'
    WHERE o.slug = 'default-imported'
    ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role
  `);
  await pool.end();
})().catch(async (error) => {
  console.error(error);
  await pool.end().catch(() => {});
  process.exit(1);
});
NODE

echo "==> Login"
curl -fsS -c "$COOKIES" -X POST "$BASE/api/login" \
  -H 'Content-Type: application/json' \
  -d '{"username":"ci-smoke","password":"ci-smoke-password"}' | grep -q '"success":true'

echo "==> Session survives (check-auth)"
curl -fsS -b "$COOKIES" "$BASE/api/check-auth" | grep -q '"isAuthenticated":true'

echo "==> Authenticated survey CRUD"
curl -fsS -b "$COOKIES" -X POST "$BASE/api/survey" \
  -H 'Content-Type: application/json' \
  -d '{"surveyName":"CISmokeSurvey"}' >/dev/null
SURVEYS=$(curl -fsS -b "$COOKIES" "$BASE/api/surveys")
echo "$SURVEYS" | grep -q 'CISmokeSurvey'
SURVEY_ID=$(printf '%s' "$SURVEYS" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).surveys.find(x=>x.name==='CISmokeSurvey').id))")

echo "==> Seed launch readiness and worker heartbeat"
SURVEY_ID="$SURVEY_ID" node <<'NODE'
const { createRequire } = require('module');
const path = require('path');
const apiRequire = createRequire(path.resolve(process.cwd(), 'api/package.json'));
const { Pool } = apiRequire('pg');
const pool = new Pool({ user:process.env.DB_USER, password:process.env.DB_PASSWORD, host:process.env.DB_HOST, port:Number(process.env.DB_PORT), database:process.env.DB_NAME });
(async () => {
  const survey = await pool.query(`UPDATE survey SET questions=$2::jsonb WHERE id=$1 RETURNING id,name`, [process.env.SURVEY_ID, JSON.stringify({elements:[{type:'text',name:'question_1',title:'Smoke question'}]})]);
  await pool.query(`INSERT INTO respondent(name,contact_info,survey_name,survey_id,can_respond,uuid,lang,email_sent) VALUES
    ('Smoke Respondent','smoke@example.test',$1,$2,true,'ci-smoke-respondent-token','English',false),
    ('Smoke Respondent Two','smoke2@example.test',$1,$2,true,'ci-smoke-respondent-token-2','English',false),
    ('Smoke Respondent Three','smoke3@example.test',$1,$2,true,'ci-smoke-respondent-token-3','English',false)`, [survey.rows[0].name,survey.rows[0].id]);
  await pool.query(`INSERT INTO email(survey_name,survey_id,lang,text) VALUES($1,$2,'English','Please complete the smoke survey.')`, [survey.rows[0].name,survey.rows[0].id]);
  await pool.query(`INSERT INTO email_worker_heartbeats(environment,worker_instance,release_revision,enabled,claiming,heartbeat_at) VALUES('test','ci-smoke','local',true,true,now()) ON CONFLICT(environment,worker_instance) DO UPDATE SET heartbeat_at=now(),enabled=true,claiming=true`);
  await pool.end();
})().catch(async (error) => { console.error(error); await pool.end().catch(()=>{}); process.exit(1); });
NODE

echo "==> Durable lifecycle launch is ready and idempotent"
curl -fsS -b "$COOKIES" "$BASE/api/surveys/$SURVEY_ID/launch-readiness" | grep -q '"canLaunch":true'
LAUNCH_HEADERS=$(mktemp)
LAUNCH_BODY=$(mktemp)
curl -fsS -D "$LAUNCH_HEADERS" -o "$LAUNCH_BODY" -b "$COOKIES" -X POST "$BASE/api/surveys/$SURVEY_ID/launches" \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: 11111111-1111-4111-8111-111111111111' -d '{"kind":"initial"}'
grep -q '202' "$LAUNCH_HEADERS"
grep -q 'Invitation launch queued' "$LAUNCH_BODY"
curl -fsS -b "$COOKIES" -X POST "$BASE/api/surveys/$SURVEY_ID/launches" \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: 11111111-1111-4111-8111-111111111111' -d '{"kind":"initial"}' | grep -q '"replayed":true'
curl -fsS -b "$COOKIES" "$BASE/api/surveys/$SURVEY_ID/launches" | grep -q '"status":"queued"'

echo "==> Real PostgreSQL worker/provider-boundary close race is fenced and recorded"
SURVEY_ID="$SURVEY_ID" node scripts/ci/lifecycle-worker-smoke.js
STATUS=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/questions?surveyName=CISmokeSurvey&userId=ci-smoke-respondent-token")
[ "$STATUS" = "403" ] || { echo "!! expected closed respondent link to return 403, got $STATUS" >&2; exit 1; }
rm -f "$LAUNCH_HEADERS" "$LAUNCH_BODY"

echo "==> Smoke test passed"

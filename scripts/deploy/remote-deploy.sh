#!/usr/bin/env bash
# Installs an extracted API release on the instance: dependencies, runtime
# config from the config bucket, Liquibase migrations, then a PM2 reload.
#
# Runs ON the EC2 instance (as root, via SSM Run Command or cloud-init):
#   bash <extracted-artifact-dir>/deploy/remote-deploy.sh <extracted-artifact-dir>
#
# The artifact is produced by .github/workflows/deploy.yml and contains:
#   api/            API source + package-lock.json
#   db/changelogs/  Liquibase changelogs
#   deploy/         this script
#   REVISION        git SHA of the release
set -euo pipefail

SOURCE_DIR=${1:?usage: remote-deploy.sh <extracted-artifact-dir>}
SERVICE_DIR=/opt/service
PM2_APP=ona-api
PM2_WORKER=ona-email-worker
PM2_WEBHOOK_WORKER=ona-email-webhook-worker

source "$SERVICE_DIR/deploy.env"
export AWS_DEFAULT_REGION

if [ "$ENVIRONMENT" = "prod-secondary" ]; then
  # Serialize prod-secondary cloud-init, CI, rollback, and operator deployments.
  # Concurrent release symlink, migration, and control-handoff mutation is unsafe.
  exec 8>/run/lock/ona-deploy.lock
  flock -w 60 8 || { echo 'Another deployment still holds /run/lock/ona-deploy.lock' >&2; exit 75; }
fi

REVISION=$(cat "$SOURCE_DIR/REVISION")
RELEASE_CAPABILITY_ARGS=()
if [ "$ENVIRONMENT" = "prod-secondary" ]; then
  RELEASE_CAPABILITY_ARGS+=(--require-prod-secondary-resend-isolation)
  # Absent only during the prerequisite rollout while ALB still checks /health.
  # Terraform stamps existing hosts after the migration and every new /live
  # launch-template host creates this marker before bootstrap.
  if [ -f "$SERVICE_DIR/alb-live-health-required" ]; then
    RELEASE_CAPABILITY_ARGS+=(--require-alb-live-health)
  fi
fi
node "$SOURCE_DIR/deploy/validate-release-capabilities.js" "$SOURCE_DIR" "${RELEASE_CAPABILITY_ARGS[@]}"
test -f "$SOURCE_DIR/api/webhook-worker.js" || { echo "Release lacks dedicated webhook worker" >&2; exit 1; }
DEPLOYMENT_ID="${REVISION}-$(date +%s)-$$"
PREVIOUS_RELEASE=$(readlink -f "$SERVICE_DIR/current" 2>/dev/null || true)
RELEASE_DIR="$SERVICE_DIR/releases/$REVISION"
if [ -n "$PREVIOUS_RELEASE" ] && [ "$RELEASE_DIR" = "$PREVIOUS_RELEASE" ]; then
  RELEASE_DIR="$SERVICE_DIR/releases/${REVISION}-redeploy-$(date +%s)"
fi

run_pm2() {
  sudo -u ubuntu -H env NODE_ENV=prod EMAIL_WORKER_ENV="${WORKER_ENV:-prod}" RELEASE_REVISION="${REVISION:-unknown}" DEPLOYMENT_ID="${DEPLOYMENT_ID:-unknown}" PM2_HOME=/home/ubuntu/.pm2 pm2 "$@"
}

echo "==> Installing release $REVISION to $RELEASE_DIR"
rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"
cp -a "$SOURCE_DIR/api" "$SOURCE_DIR/db" "$SOURCE_DIR/deploy" "$RELEASE_DIR/"
printf '%s\n' "$REVISION" > "$RELEASE_DIR/REVISION"

echo "==> Installing production dependencies"
(cd "$RELEASE_DIR/api" && npm ci --omit=dev --workspaces=false)

echo "==> Fetching runtime config"
CONFIG_KEY=${CONFIG_KEY:-configs/.env.prod}
aws s3 cp "s3://$CONFIG_BUCKET/$CONFIG_KEY" "$RELEASE_DIR/api/.env.prod"
chmod 600 "$RELEASE_DIR/api/.env.prod"

get_env_value() {
  grep "^$1=" "$RELEASE_DIR/api/.env.prod" | cut -d= -f2-
}

get_secret_from_ssm() {
  local parameter_env_key="$1"
  local parameter_name

  parameter_name=$(get_env_value "$parameter_env_key")
  if [ -z "$parameter_name" ]; then
    echo "Missing $parameter_env_key in runtime config" >&2
    exit 1
  fi

  aws ssm get-parameter \
    --name "$parameter_name" \
    --with-decryption \
    --query 'Parameter.Value' \
    --output text
}

append_secret_value() {
  local env_key="$1"
  local value="$2"

  ENV_KEY="$env_key" SECRET_VALUE="$value" node - <<'NODE' >> "$RELEASE_DIR/api/.env.prod"
const key = process.env.ENV_KEY;
const value = process.env.SECRET_VALUE || '';
process.stdout.write(`${key}=${JSON.stringify(value)}\n`);
NODE
}

append_secret_from_ssm() {
  local env_key="$1"
  local parameter_env_key="$2"
  local value

  value=$(get_secret_from_ssm "$parameter_env_key")
  append_secret_value "$env_key" "$value"
}

echo "==> Resolving runtime secrets"
DB_MANAGED_SECRET_ARN=$(get_env_value DB_MANAGED_SECRET_ARN || true)
if [ -n "$DB_MANAGED_SECRET_ARN" ]; then
  DB_MANAGED_SECRET_JSON=$(aws secretsmanager get-secret-value --secret-id "$DB_MANAGED_SECRET_ARN" --query SecretString --output text)
  DB_MANAGED_PASSWORD=$(SECRET_JSON="$DB_MANAGED_SECRET_JSON" node -e 'const value=JSON.parse(process.env.SECRET_JSON);if(typeof value.password!=="string"||!value.password)process.exit(1);process.stdout.write(value.password)')
  append_secret_value DB_PASSWORD "$DB_MANAGED_PASSWORD"
  unset DB_MANAGED_SECRET_JSON DB_MANAGED_PASSWORD
else
  append_secret_from_ssm DB_PASSWORD DB_PASSWORD_PARAMETER
fi
append_secret_from_ssm SESSION_SECRET SESSION_SECRET_PARAMETER
RUNTIME_EMAIL_ENV=$(get_env_value EMAIL_WORKER_ENV || true)
RESEND_API_KEY_PARAMETER=$(get_env_value RESEND_API_KEY_PARAMETER || true)
if [ "$RUNTIME_EMAIL_ENV" = "prod-secondary" ]; then
  test "$(get_env_value RESEND_PROVIDER_ACCOUNT_SCOPE)" = "network-survey-resend-prod-secondary" || { echo 'Invalid prod-secondary Resend account scope' >&2; exit 1; }
  test "$(get_env_value SURVEY_EMAIL_SENDER)" = "CLA Survey <survey@cladvisorsurveys.com>" || { echo 'Invalid prod-secondary sender identity' >&2; exit 1; }
  test "$(get_env_value SURVEY_EMAIL_REPLY_TO)" = "survey@cladvisors.com" || { echo 'Invalid prod-secondary Reply-To identity' >&2; exit 1; }
  if [ "$(get_env_value RESEND_CREDENTIAL_LOAD_ENABLED)" = "true" ]; then
    test "$RESEND_API_KEY_PARAMETER" = "/network-survey/prod-secondary/resend/api-key" || { echo 'Invalid prod-secondary Resend API key path' >&2; exit 1; }
    append_secret_from_ssm RESEND_API_KEY RESEND_API_KEY_PARAMETER
  else
    test -z "$RESEND_API_KEY_PARAMETER" || { echo 'prod-secondary API key path must be absent while credential loading is disabled' >&2; exit 1; }
  fi
  if [ "$(get_env_value RESEND_WEBHOOK_INGEST_ENABLED)" = "true" ]; then
    test "$(get_env_value RESEND_WEBHOOK_SECRET_PARAMETER)" = "/network-survey/prod-secondary/resend/webhook-secret" || { echo 'Invalid prod-secondary webhook secret path' >&2; exit 1; }
    test "$(get_env_value RESEND_WEBHOOK_PREVIOUS_SECRET_PARAMETER)" = "/network-survey/prod-secondary/resend/webhook-previous-secret" || { echo 'Invalid prod-secondary previous webhook secret path' >&2; exit 1; }
  else
    test -z "$(get_env_value RESEND_WEBHOOK_SECRET_PARAMETER)" || { echo 'prod-secondary webhook secret path must be absent while ingestion is disabled' >&2; exit 1; }
    test -z "$(get_env_value RESEND_WEBHOOK_PREVIOUS_SECRET_PARAMETER)" || { echo 'prod-secondary previous webhook secret path must be absent while ingestion is disabled' >&2; exit 1; }
  fi
elif [ -n "$RESEND_API_KEY_PARAMETER" ]; then
  append_secret_from_ssm RESEND_API_KEY RESEND_API_KEY_PARAMETER
else
  echo "Missing RESEND_API_KEY_PARAMETER in runtime config" >&2
  exit 1
fi
if [ "$(get_env_value RESEND_WEBHOOK_INGEST_ENABLED)" = "true" ]; then
  append_secret_from_ssm RESEND_WEBHOOK_SECRET RESEND_WEBHOOK_SECRET_PARAMETER
  PREVIOUS_WEBHOOK_PARAMETER=$(get_env_value RESEND_WEBHOOK_PREVIOUS_SECRET_PARAMETER)
if [ -n "$PREVIOUS_WEBHOOK_PARAMETER" ]; then
  OPTIONAL_SSM_ERROR=$(mktemp)
  set +e
  PREVIOUS_WEBHOOK_SECRET=$(aws ssm get-parameter --name "$PREVIOUS_WEBHOOK_PARAMETER" --with-decryption --query 'Parameter.Value' --output text 2>"$OPTIONAL_SSM_ERROR")
  OPTIONAL_SSM_STATUS=$?
  set -e
  if [ "$OPTIONAL_SSM_STATUS" -ne 0 ]; then
    if grep -q 'ParameterNotFound' "$OPTIONAL_SSM_ERROR"; then
      PREVIOUS_WEBHOOK_SECRET=
    else
      rm -f "$OPTIONAL_SSM_ERROR"
      echo "Unable to read optional previous webhook secret parameter" >&2
      exit 1
    fi
  fi
  rm -f "$OPTIONAL_SSM_ERROR"
  if [ -n "$PREVIOUS_WEBHOOK_SECRET" ] && [ "$PREVIOUS_WEBHOOK_SECRET" != "None" ]; then
    ENV_KEY=RESEND_WEBHOOK_PREVIOUS_SECRET SECRET_VALUE="$PREVIOUS_WEBHOOK_SECRET" node - <<'NODE' >> "$RELEASE_DIR/api/.env.prod"
const value = process.env.SECRET_VALUE || '';
process.stdout.write(`RESEND_WEBHOOK_PREVIOUS_SECRET=${JSON.stringify(value)}\n`);
NODE
  fi
  unset PREVIOUS_WEBHOOK_SECRET
  fi
fi
WORKER_ENV=$(get_env_value EMAIL_WORKER_ENV)
case "$WORKER_ENV" in
  staging|prod|prod-secondary) ;;
  *) echo "EMAIL_WORKER_ENV must be explicitly configured as staging, prod, or prod-secondary" >&2; exit 1 ;;
esac

# Resolve migration connection details before the handoff. The migration itself
# runs only after old dispatch and projector workers are quiesced below.
# Liquibase runs from this host because the database only accepts
# connections from the backend security group.
read_runtime_env() {
  (cd "$RELEASE_DIR/api" && ENV_FILE="$RELEASE_DIR/api/.env.prod" ENV_KEY="$1" node - <<'NODE'
require('dotenv').config({ path: process.env.ENV_FILE });
process.stdout.write(process.env[process.env.ENV_KEY] || '');
NODE
)
}

DB_HOST=$(read_runtime_env DB_HOST)
DB_PORT=$(read_runtime_env DB_PORT)
DB_NAME=$(read_runtime_env DB_NAME)
DB_USER=$(read_runtime_env DB_USER)
DB_PASSWORD=$(read_runtime_env DB_PASSWORD)
# changeLogFile must stay under "changelogs/..." — included changeset paths are
# the identities recorded in DATABASECHANGELOG by all prior runs. The dedicated
# cutover root is selected only by explicit production runtime configuration;
# local, CI, and staging use the universal non-data-moving master changelog.
CHANGELOG_FILE=changelogs/master-changelog.xml
if [ "$(get_env_value CLA_PRODUCTION_CUTOVER)" = "true" ]; then
  CHANGELOG_FILE=changelogs/cla-production-cutover.xml
fi
run_database_migrations() {
  echo "==> Running database migrations after worker quiescence"
  liquibase \
    --url="jdbc:postgresql://$DB_HOST:$DB_PORT/${DB_NAME:-ONA}?sslmode=verify-full&sslrootcert=$SERVICE_DIR/certs/rds-global-bundle.pem" \
    --username="$DB_USER" \
    --password="$DB_PASSWORD" \
    --changeLogFile="$CHANGELOG_FILE" \
    --searchPath="$RELEASE_DIR/db" \
    update
}

ensure_bootstrap_administrator() {
if [ -n "$(get_env_value BOOTSTRAP_ADMIN_PASSWORD_PARAMETER)" ]; then
  echo "==> Ensuring bootstrap dashboard administrator"
  BOOTSTRAP_ADMIN_PASSWORD=$(get_secret_from_ssm BOOTSTRAP_ADMIN_PASSWORD_PARAMETER)
  BOOTSTRAP_ADMIN_USERNAME=$(get_env_value BOOTSTRAP_ADMIN_USERNAME)
  BOOTSTRAP_ADMIN_EMAIL=$(get_env_value BOOTSTRAP_ADMIN_EMAIL)
  BOOTSTRAP_ADMIN_IDENTITY_PARAMETER=$(get_env_value BOOTSTRAP_ADMIN_IDENTITY_PARAMETER || true)
  if [ -n "$BOOTSTRAP_ADMIN_IDENTITY_PARAMETER" ]; then
    BOOTSTRAP_ADMIN_IDENTITY_JSON=$(get_secret_from_ssm BOOTSTRAP_ADMIN_IDENTITY_PARAMETER)
    BOOTSTRAP_ADMIN_USERNAME=$(SECRET_JSON="$BOOTSTRAP_ADMIN_IDENTITY_JSON" node -e 'const value=JSON.parse(process.env.SECRET_JSON);if(typeof value.username!=="string"||!value.username)process.exit(1);process.stdout.write(value.username)')
    BOOTSTRAP_ADMIN_EMAIL=$(SECRET_JSON="$BOOTSTRAP_ADMIN_IDENTITY_JSON" node -e 'const value=JSON.parse(process.env.SECRET_JSON);if(typeof value.email!=="string"||!value.email)process.exit(1);process.stdout.write(value.email)')
    unset BOOTSTRAP_ADMIN_IDENTITY_JSON
  fi
  BOOTSTRAP_ADMIN_USERNAME="$BOOTSTRAP_ADMIN_USERNAME" \
    BOOTSTRAP_ADMIN_EMAIL="$BOOTSTRAP_ADMIN_EMAIL" \
    BOOTSTRAP_ORGANIZATION_NAME=$(get_env_value BOOTSTRAP_ORGANIZATION_NAME) \
    BOOTSTRAP_ORGANIZATION_SLUG=$(get_env_value BOOTSTRAP_ORGANIZATION_SLUG) \
    BOOTSTRAP_PLATFORM_ADMIN=$(get_env_value BOOTSTRAP_PLATFORM_ADMIN) \
    BOOTSTRAP_ACCOUNT_MODE=$(get_env_value BOOTSTRAP_ACCOUNT_MODE) \
    BOOTSTRAP_ADMIN_PASSWORD="$BOOTSTRAP_ADMIN_PASSWORD" \
    DB_HOST="$DB_HOST" DB_PORT="$DB_PORT" DB_NAME="$DB_NAME" DB_USER="$DB_USER" DB_PASSWORD="$DB_PASSWORD" \
    DB_SSL=true DB_SSL_CA="$SERVICE_DIR/certs/rds-global-bundle.pem" \
    node "$RELEASE_DIR/deploy/bootstrap-admin.js"
  unset BOOTSTRAP_ADMIN_PASSWORD BOOTSTRAP_ADMIN_USERNAME BOOTSTRAP_ADMIN_EMAIL
fi
}

CLAIMING_WAS_ENABLED=false
WEBHOOK_PROCESSING_WAS_ENABLED=false
SENDING_WAS_ENABLED=false
SENDING_CONTROL_REVISION=0
WEBHOOK_CONTROL_REVISION=0
PREVIOUS_WEBHOOK_DEPLOYMENT_ID=""
MIGRATION_STARTED=false
restore_pre_activation_handoff() {
  local status=$?
  if [ "$status" -ne 0 ] && { [ "$CLAIMING_WAS_ENABLED" = true ] || [ "$SENDING_WAS_ENABLED" = true ] || [ "$WEBHOOK_PROCESSING_WAS_ENABLED" = true ]; } && [ -n "$PREVIOUS_RELEASE" ]; then
    local previous_revision
    previous_revision=$(cat "$PREVIOUS_RELEASE/REVISION" 2>/dev/null || true)
    if [ -n "$previous_revision" ]; then
      if [ "$MIGRATION_STARTED" = true ] && ! node "$RELEASE_DIR/deploy/validate-release-capabilities.js" "$PREVIOUS_RELEASE" --database "${RELEASE_CAPABILITY_ARGS[@]}"; then
        echo "Previous release is below the post-migration database floor; leaving email controls paused" >&2
        return
      fi
      set +e
      if [ "$CLAIMING_WAS_ENABLED" = true ]; then
        (cd "$RELEASE_DIR/api" && EMAIL_WORKER_ENV="$WORKER_ENV" EXPECTED_RELEASE_REVISION="$previous_revision" NODE_ENV=prod node ../deploy/set-email-claiming.js true failed-pre-activation-handoff)
      fi
      if [ "$SENDING_WAS_ENABLED" = true ]; then
        (cd "$RELEASE_DIR/api" && EMAIL_WORKER_ENV="$WORKER_ENV" EXPECTED_RELEASE_REVISION="$previous_revision" NODE_ENV=prod node ../deploy/set-email-sending.js true "$SENDING_CONTROL_REVISION" deploy failed-pre-activation-handoff)
      fi
      if [ "$WEBHOOK_PROCESSING_WAS_ENABLED" = true ] && [ -n "$PREVIOUS_WEBHOOK_DEPLOYMENT_ID" ]; then
        (cd "$RELEASE_DIR/api" && EMAIL_WORKER_ENV="$WORKER_ENV" EXPECTED_RELEASE_REVISION="$previous_revision" EXPECTED_DEPLOYMENT_ID="$PREVIOUS_WEBHOOK_DEPLOYMENT_ID" NODE_ENV=prod node ../deploy/set-webhook-processing.js true "$WEBHOOK_CONTROL_REVISION" deploy failed-pre-activation-handoff)
      fi
      set -e
    fi
  fi
}
trap restore_pre_activation_handoff EXIT

SENDING_CONTROL=$(cd "$RELEASE_DIR/api" && node - <<'NODE'
require('dotenv').config({path:'.env.prod'});
const {Pool}=require('pg');
const pool=new Pool({user:process.env.DB_USER,password:process.env.DB_PASSWORD,host:process.env.DB_HOST,port:process.env.DB_PORT,database:process.env.DB_NAME||'ONA',ssl:process.env.DB_SSL==='true'?{ca:process.env.DB_SSL_CA?require('fs').readFileSync(process.env.DB_SSL_CA,'utf8'):undefined,rejectUnauthorized:Boolean(process.env.DB_SSL_CA)}:undefined});
(async()=>{const exists=(await pool.query(`SELECT to_regclass('email_sending_control') AS table_name`)).rows[0]?.table_name;if(!exists)return process.stdout.write('false:0');const r=await pool.query('SELECT sending_enabled,control_revision FROM email_sending_control WHERE environment=$1',[process.env.EMAIL_WORKER_ENV]);process.stdout.write(`${r.rows[0]?.sending_enabled?'true':'false'}:${r.rows[0]?.control_revision??0}`);})().finally(()=>pool.end());
NODE
)
SENDING_WAS_ENABLED=${SENDING_CONTROL%%:*}
SENDING_CONTROL_REVISION=${SENDING_CONTROL#*:}
if [ "$SENDING_WAS_ENABLED" = true ]; then
  echo "==> Pausing all application email sends for release handoff"
  (cd "$RELEASE_DIR/api" && EMAIL_WORKER_ENV="$WORKER_ENV" NODE_ENV=prod node ../deploy/set-email-sending.js false "$SENDING_CONTROL_REVISION" deploy release-handoff)
  SENDING_CONTROL_REVISION=$((SENDING_CONTROL_REVISION + 1))
fi

CLAIMING_WAS_ENABLED=$(cd "$RELEASE_DIR/api" && node - <<'NODE'
require('dotenv').config({path:'.env.prod'});
const {Pool}=require('pg');
const pool=new Pool({user:process.env.DB_USER,password:process.env.DB_PASSWORD,host:process.env.DB_HOST,port:process.env.DB_PORT,database:process.env.DB_NAME||'ONA',ssl:process.env.DB_SSL==='true'?{ca:process.env.DB_SSL_CA?require('fs').readFileSync(process.env.DB_SSL_CA,'utf8'):undefined,rejectUnauthorized:Boolean(process.env.DB_SSL_CA)}:undefined});
(async()=>{const exists=(await pool.query(`SELECT to_regclass('email_worker_control') AS table_name`)).rows[0]?.table_name;if(!exists)return process.stdout.write('false');const r=await pool.query('SELECT claiming_enabled FROM email_worker_control WHERE environment=$1',[process.env.EMAIL_WORKER_ENV]);process.stdout.write(r.rows[0]?.claiming_enabled?'true':'false');})().finally(()=>pool.end());
NODE
)
if [ "$CLAIMING_WAS_ENABLED" = true ]; then
  echo "==> Pausing email claims for release handoff"
  (cd "$RELEASE_DIR/api" && EMAIL_WORKER_ENV="$WORKER_ENV" NODE_ENV=prod node ../deploy/set-email-claiming.js false release-handoff)
fi

WEBHOOK_CONTROL=$(cd "$RELEASE_DIR/api" && node - <<'NODE'
require('dotenv').config({path:'.env.prod'});
const {Pool}=require('pg');
const pool=new Pool({user:process.env.DB_USER,password:process.env.DB_PASSWORD,host:process.env.DB_HOST,port:process.env.DB_PORT,database:process.env.DB_NAME||'ONA',ssl:process.env.DB_SSL==='true'?{ca:process.env.DB_SSL_CA?require('fs').readFileSync(process.env.DB_SSL_CA,'utf8'):undefined,rejectUnauthorized:Boolean(process.env.DB_SSL_CA)}:undefined});
(async()=>{const exists=(await pool.query(`SELECT to_regclass('email_webhook_worker_control') AS table_name`)).rows[0]?.table_name;if(!exists)return process.stdout.write('false:0:');const r=await pool.query(`SELECT c.processing_enabled,c.control_revision,(SELECT split_part(h.worker_instance,'/',1) FROM email_webhook_worker_heartbeats h WHERE h.environment=c.environment AND h.heartbeat_at>now()-interval '45 seconds' ORDER BY h.heartbeat_at DESC LIMIT 1) AS deployment_id FROM email_webhook_worker_control c WHERE c.environment=$1`,[process.env.EMAIL_WORKER_ENV]);process.stdout.write(`${r.rows[0]?.processing_enabled?'true':'false'}:${r.rows[0]?.control_revision??0}:${r.rows[0]?.deployment_id??''}`);})().finally(()=>pool.end());
NODE
)
WEBHOOK_PROCESSING_WAS_ENABLED=${WEBHOOK_CONTROL%%:*}
WEBHOOK_CONTROL_REST=${WEBHOOK_CONTROL#*:}
WEBHOOK_CONTROL_REVISION=${WEBHOOK_CONTROL_REST%%:*}
PREVIOUS_WEBHOOK_DEPLOYMENT_ID=${WEBHOOK_CONTROL_REST#*:}
if [ "$WEBHOOK_PROCESSING_WAS_ENABLED" = true ]; then
  echo "==> Pausing webhook projection for release handoff"
  (cd "$RELEASE_DIR/api" && EMAIL_WORKER_ENV="$WORKER_ENV" NODE_ENV=prod node ../deploy/set-webhook-processing.js false "$WEBHOOK_CONTROL_REVISION" deploy release-handoff)
  WEBHOOK_CONTROL_REVISION=$((WEBHOOK_CONTROL_REVISION + 1))
fi

echo "==> Waiting for dispatch and webhook workers to observe disabled controls"
WORKERS_QUIESCED=false
for _ in $(seq 1 90); do
  ACTIVE_WORKERS=$(cd "$RELEASE_DIR/api" && node - <<'NODE'
require('dotenv').config({path:'.env.prod'});
const fs=require('fs');const {Pool}=require('pg');
const pool=new Pool({user:process.env.DB_USER,password:process.env.DB_PASSWORD,host:process.env.DB_HOST,port:process.env.DB_PORT,database:process.env.DB_NAME||'ONA',ssl:process.env.DB_SSL==='true'?{ca:process.env.DB_SSL_CA?fs.readFileSync(process.env.DB_SSL_CA,'utf8'):undefined,rejectUnauthorized:Boolean(process.env.DB_SSL_CA)}:undefined});
(async()=>{const tables=(await pool.query(`SELECT to_regclass('email_worker_heartbeats') AS email,to_regclass('email_webhook_worker_heartbeats') AS webhook`)).rows[0];let active=0;if(tables.email)active+=Number((await pool.query(`SELECT count(*)::int AS count FROM email_worker_heartbeats WHERE environment=$1 AND claiming=true AND heartbeat_at>now()-interval '45 seconds'`,[process.env.EMAIL_WORKER_ENV])).rows[0].count);if(tables.webhook)active+=Number((await pool.query(`SELECT count(*)::int AS count FROM email_webhook_worker_heartbeats WHERE environment=$1 AND processing=true AND heartbeat_at>now()-interval '45 seconds'`,[process.env.EMAIL_WORKER_ENV])).rows[0].count);process.stdout.write(String(active));})().finally(()=>pool.end());
NODE
)
  if [ "$ACTIVE_WORKERS" = 0 ]; then WORKERS_QUIESCED=true; break; fi
  sleep 1
done
if [ "$WORKERS_QUIESCED" != true ]; then
  echo "Workers did not quiesce before the migration deadline; refusing schema state conversion" >&2
  exit 1
fi

# Apply state-converting migrations only after capability-1 workers can no
# longer finalize or project rows using the old status vocabulary. Mark the
# database as potentially changed before invoking Liquibase because an update
# can commit earlier changesets before a later one fails.
MIGRATION_STARTED=true
run_database_migrations

# Registration/suppression activation can raise the rollback floor. Validate
# after migrations and quiescence, before changing any process or symlink.
node "$RELEASE_DIR/deploy/validate-release-capabilities.js" "$RELEASE_DIR" --database
ensure_bootstrap_administrator

echo "==> Activating release"
chown -R ubuntu:ubuntu "$RELEASE_DIR"
ACTIVATED=false
HANDOFF_REENABLED=false
WEBHOOK_HANDOFF_REENABLED=false
SENDING_HANDOFF_REENABLED=false
restore_previous_release() {
  local status=$?
  if [ "$status" -ne 0 ] && [ -n "$PREVIOUS_RELEASE" ] && [ -d "$PREVIOUS_RELEASE" ]; then
    echo "!! Validating previous release before automatic restore" >&2
    if ! node "$RELEASE_DIR/deploy/validate-release-capabilities.js" "$PREVIOUS_RELEASE" --database "${RELEASE_CAPABILITY_ARGS[@]}"; then
      echo "!! Previous release is below the active capability floor; refusing unsafe automatic restore" >&2
      set +e
      run_pm2 stop "$PM2_APP" "$PM2_WORKER" "$PM2_WEBHOOK_WORKER" >/dev/null 2>&1
      set -e
      return
    fi
    echo "!! Restoring previous release $PREVIOUS_RELEASE" >&2
    set +e
    if [ "$ACTIVATED" = true ]; then ln -sfn "$PREVIOUS_RELEASE" "$SERVICE_DIR/current"; fi
    REVISION=$(cat "$PREVIOUS_RELEASE/REVISION" 2>/dev/null || basename "$PREVIOUS_RELEASE")
    if [ "$WEBHOOK_HANDOFF_REENABLED" = true ]; then
      (cd "$RELEASE_DIR/api" && EMAIL_WORKER_ENV="$WORKER_ENV" NODE_ENV=prod node ../deploy/set-webhook-processing.js false "$WEBHOOK_CONTROL_REVISION" deploy failed-release-handoff)
      WEBHOOK_CONTROL_REVISION=$((WEBHOOK_CONTROL_REVISION + 1))
    fi
    if [ "$SENDING_HANDOFF_REENABLED" = true ]; then
      (cd "$RELEASE_DIR/api" && EMAIL_WORKER_ENV="$WORKER_ENV" NODE_ENV=prod node ../deploy/set-email-sending.js false "$SENDING_CONTROL_REVISION" deploy failed-release-handoff)
      SENDING_CONTROL_REVISION=$((SENDING_CONTROL_REVISION + 1))
    fi
    if [ -f "$PREVIOUS_RELEASE/deploy/set-email-claiming.js" ]; then
      (cd "$PREVIOUS_RELEASE/api" && EMAIL_WORKER_ENV="$WORKER_ENV" NODE_ENV=prod node ../deploy/set-email-claiming.js false failed-release-handoff)
    else
      (cd "$RELEASE_DIR/api" && EMAIL_WORKER_ENV="$WORKER_ENV" NODE_ENV=prod node ../deploy/set-email-claiming.js false failed-release-handoff)
    fi
    if [ -f "$PREVIOUS_RELEASE/deploy/ecosystem.config.js" ]; then
      run_pm2 startOrReload "$SERVICE_DIR/current/deploy/ecosystem.config.js" --update-env
    else
      run_pm2 delete "$PM2_WORKER" >/dev/null 2>&1 || true
      run_pm2 delete "$PM2_APP" >/dev/null 2>&1 || true
      run_pm2 start "$PREVIOUS_RELEASE/api/server.js" --name "$PM2_APP" --cwd "$PREVIOUS_RELEASE/api"
    fi
    run_pm2 save
    echo "!! Verifying restored API and fresh paused worker heartbeats before restoring traffic" >&2
    RESTORE_HEALTHY=false
    for _ in $(seq 1 15); do
      if curl -fsS http://localhost:3000/health >/dev/null 2>&1 && { [ "$ENVIRONMENT" != "prod-secondary" ] || curl -fsS http://localhost:3000/live >/dev/null 2>&1; } && (cd "$PREVIOUS_RELEASE/api" && EXPECTED_REVISION="$REVISION" EXPECTED_WORKER_ENV="$WORKER_ENV" EXPECTED_DEPLOYMENT_ID="$DEPLOYMENT_ID" node - <<'NODE'
require('dotenv').config({path:'.env.prod'});const{Pool}=require('pg');const fs=require('fs');const p=new Pool({user:process.env.DB_USER,password:process.env.DB_PASSWORD,host:process.env.DB_HOST,port:process.env.DB_PORT,database:process.env.DB_NAME||'ONA',ssl:process.env.DB_SSL==='true'?{ca:process.env.DB_SSL_CA?fs.readFileSync(process.env.DB_SSL_CA,'utf8'):undefined,rejectUnauthorized:Boolean(process.env.DB_SSL_CA)}:undefined});Promise.all([p.query(`SELECT 1 FROM email_worker_heartbeats WHERE environment=$1 AND release_revision=$2 AND worker_instance LIKE $3||'/%' AND heartbeat_at>now()-interval '20 seconds'`,[process.env.EXPECTED_WORKER_ENV,process.env.EXPECTED_REVISION,process.env.EXPECTED_DEPLOYMENT_ID]),p.query(`SELECT 1 FROM email_webhook_worker_heartbeats WHERE environment=$1 AND release_revision=$2 AND worker_instance LIKE $3||'/%' AND heartbeat_at>now()-interval '20 seconds'`,[process.env.EXPECTED_WORKER_ENV,process.env.EXPECTED_REVISION,process.env.EXPECTED_DEPLOYMENT_ID])]).then(r=>process.exitCode=r.every(x=>x.rowCount)?0:1).catch(()=>process.exitCode=1).finally(()=>p.end());
NODE
      ); then RESTORE_HEALTHY=true; break; fi
      sleep 2
    done
    if [ "$RESTORE_HEALTHY" != true ]; then
      echo "!! Restored release did not become healthy; leaving all outbound controls paused" >&2
      run_pm2 stop "$PM2_APP" "$PM2_WORKER" "$PM2_WEBHOOK_WORKER" >/dev/null 2>&1 || true
      set -e
      return
    fi
    if [ "$SENDING_WAS_ENABLED" = true ] && [ -f "$PREVIOUS_RELEASE/deploy/set-email-sending.js" ]; then
      (cd "$PREVIOUS_RELEASE/api" && EMAIL_WORKER_ENV="$WORKER_ENV" EXPECTED_RELEASE_REVISION="$REVISION" NODE_ENV=prod node ../deploy/set-email-sending.js true "$SENDING_CONTROL_REVISION" deploy failed-release-restore)
      SENDING_CONTROL_REVISION=$((SENDING_CONTROL_REVISION + 1))
    fi
    if [ "$CLAIMING_WAS_ENABLED" = true ]; then
      if [ -f "$PREVIOUS_RELEASE/deploy/set-email-claiming.js" ]; then
        (cd "$PREVIOUS_RELEASE/api" && EMAIL_WORKER_ENV="$WORKER_ENV" EXPECTED_RELEASE_REVISION="$REVISION" NODE_ENV=prod node ../deploy/set-email-claiming.js true failed-release-restore)
      fi
    fi
    if [ "$WEBHOOK_PROCESSING_WAS_ENABLED" = true ] && [ -f "$PREVIOUS_RELEASE/deploy/set-webhook-processing.js" ]; then
      sleep 2
      (cd "$PREVIOUS_RELEASE/api" && EMAIL_WORKER_ENV="$WORKER_ENV" EXPECTED_RELEASE_REVISION="$REVISION" EXPECTED_DEPLOYMENT_ID="$DEPLOYMENT_ID" NODE_ENV=prod node ../deploy/set-webhook-processing.js true "$WEBHOOK_CONTROL_REVISION" deploy failed-release-restore)
      WEBHOOK_CONTROL_REVISION=$((WEBHOOK_CONTROL_REVISION + 1))
    fi
    set -e
  fi
}
trap restore_previous_release EXIT
ln -sfn "$RELEASE_DIR" "$SERVICE_DIR/current"
ACTIVATED=true

# Drop the legacy cloud-init-era process name if it is still around
run_pm2 delete my-service >/dev/null 2>&1 || true

# The ecosystem keeps API and worker lifecycle coupled while preserving separate
# process names, logs, health signals, and graceful-stop budgets.
run_pm2 startOrReload "$SERVICE_DIR/current/deploy/ecosystem.config.js" --update-env
run_pm2 save

echo "==> Waiting for health check"
for i in $(seq 1 15); do
  if curl -fsS http://localhost:3000/health >/dev/null 2>&1 && \
    { [ "$ENVIRONMENT" != "prod-secondary" ] || curl -fsS http://localhost:3000/live >/dev/null 2>&1; } && \
    run_pm2 jlist | EXPECTED_REVISION="$REVISION" EXPECTED_DEPLOYMENT_ID="$DEPLOYMENT_ID" node -e '
      let input=""; process.stdin.on("data",d=>input+=d); process.stdin.on("end",()=>{const app=JSON.parse(input).find(p=>p.name==="ona-api"); process.exit(app?.pm2_env?.RELEASE_REVISION===process.env.EXPECTED_REVISION&&app?.pm2_env?.DEPLOYMENT_ID===process.env.EXPECTED_DEPLOYMENT_ID?0:1);});
    '; then
    if (cd "$RELEASE_DIR/api" && EXPECTED_REVISION="$REVISION" EXPECTED_WORKER_ENV="$WORKER_ENV" EXPECTED_DEPLOYMENT_ID="$DEPLOYMENT_ID" node - <<'NODE'
require('dotenv').config({path:'.env.prod'});
const { Pool } = require('pg');
const pool = new Pool({ user:process.env.DB_USER,password:process.env.DB_PASSWORD,host:process.env.DB_HOST,port:process.env.DB_PORT,database:process.env.DB_NAME||'ONA',ssl:process.env.DB_SSL==='true'?{ca:process.env.DB_SSL_CA?require('fs').readFileSync(process.env.DB_SSL_CA,'utf8'):undefined,rejectUnauthorized:Boolean(process.env.DB_SSL_CA)}:undefined });
Promise.all([
  pool.query(`SELECT 1 FROM email_worker_heartbeats h JOIN email_worker_control c USING(environment) WHERE h.environment=$2 AND h.release_revision=$1 AND h.worker_instance LIKE $3||'/%' AND h.enabled=true AND h.claiming=c.claiming_enabled AND h.heartbeat_at>now()-interval '45 seconds' LIMIT 1`,[process.env.EXPECTED_REVISION,process.env.EXPECTED_WORKER_ENV,process.env.EXPECTED_DEPLOYMENT_ID]),
  pool.query(`SELECT 1 FROM email_webhook_worker_heartbeats h JOIN email_webhook_worker_control c USING(environment) WHERE h.environment=$2 AND h.release_revision=$1 AND h.worker_instance LIKE $3||'/%' AND h.enabled=true AND h.processing=c.processing_enabled AND h.heartbeat_at>now()-interval '45 seconds' LIMIT 1`,[process.env.EXPECTED_REVISION,process.env.EXPECTED_WORKER_ENV,process.env.EXPECTED_DEPLOYMENT_ID]),
]).then((results)=>{process.exitCode=results.every((r)=>r.rowCount)?0:1;}).catch(()=>{process.exitCode=1;}).finally(()=>pool.end());
NODE
    ); then
      if [ "$SENDING_WAS_ENABLED" = true ] && [ "$SENDING_HANDOFF_REENABLED" = false ]; then
        echo "==> Fencing all application email sends to release $REVISION"
        (cd "$RELEASE_DIR/api" && EMAIL_WORKER_ENV="$WORKER_ENV" EXPECTED_RELEASE_REVISION="$REVISION" NODE_ENV=prod node ../deploy/set-email-sending.js true "$SENDING_CONTROL_REVISION" deploy release-handoff-complete)
        SENDING_HANDOFF_REENABLED=true
        SENDING_CONTROL_REVISION=$((SENDING_CONTROL_REVISION + 1))
        sleep 2
        continue
      fi
      if [ "$CLAIMING_WAS_ENABLED" = true ] && [ "$HANDOFF_REENABLED" = false ]; then
        echo "==> Fencing email claims to release $REVISION"
        (cd "$RELEASE_DIR/api" && EMAIL_WORKER_ENV="$WORKER_ENV" EXPECTED_RELEASE_REVISION="$REVISION" NODE_ENV=prod node ../deploy/set-email-claiming.js true release-handoff-complete)
        HANDOFF_REENABLED=true
        sleep 2
        continue
      fi
      if [ "$WEBHOOK_PROCESSING_WAS_ENABLED" = true ] && [ "$WEBHOOK_HANDOFF_REENABLED" = false ]; then
        echo "==> Fencing webhook projection to release $REVISION"
        (cd "$RELEASE_DIR/api" && EMAIL_WORKER_ENV="$WORKER_ENV" EXPECTED_RELEASE_REVISION="$REVISION" EXPECTED_DEPLOYMENT_ID="$DEPLOYMENT_ID" NODE_ENV=prod node ../deploy/set-webhook-processing.js true "$WEBHOOK_CONTROL_REVISION" deploy release-handoff-complete)
        WEBHOOK_HANDOFF_REENABLED=true
        WEBHOOK_CONTROL_REVISION=$((WEBHOOK_CONTROL_REVISION + 1))
        sleep 2
        continue
      fi
      echo "==> Deploy of $REVISION succeeded (API, delivery worker, and webhook worker healthy)"
      # Keep the five most recent releases
      ls -1dt "$SERVICE_DIR"/releases/* | tail -n +6 | xargs -r rm -rf
      trap - EXIT
      exit 0
    fi
  fi
  sleep 2
done

echo "!! Health check failed after deploy of $REVISION" >&2
run_pm2 logs "$PM2_APP" --nostream --lines 50 || true
run_pm2 logs "$PM2_WORKER" --nostream --lines 50 || true
run_pm2 logs "$PM2_WEBHOOK_WORKER" --nostream --lines 50 || true
exit 1

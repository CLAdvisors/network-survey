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

source "$SERVICE_DIR/deploy.env"
export AWS_DEFAULT_REGION

REVISION=$(cat "$SOURCE_DIR/REVISION")
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
aws s3 cp "s3://$CONFIG_BUCKET/configs/.env.prod" "$RELEASE_DIR/api/.env.prod"
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

append_secret_from_ssm() {
  local env_key="$1"
  local parameter_env_key="$2"
  local value

  value=$(get_secret_from_ssm "$parameter_env_key")
  ENV_KEY="$env_key" SECRET_VALUE="$value" node - <<'NODE' >> "$RELEASE_DIR/api/.env.prod"
const key = process.env.ENV_KEY;
const value = process.env.SECRET_VALUE || '';
process.stdout.write(`${key}=${JSON.stringify(value)}\n`);
NODE
}

echo "==> Resolving runtime secrets from SSM Parameter Store"
append_secret_from_ssm DB_PASSWORD DB_PASSWORD_PARAMETER
append_secret_from_ssm SESSION_SECRET SESSION_SECRET_PARAMETER
append_secret_from_ssm RESEND_API_KEY RESEND_API_KEY_PARAMETER
WORKER_ENV=$(get_env_value EMAIL_WORKER_ENV)
case "$WORKER_ENV" in
  staging|prod) ;;
  *) echo "EMAIL_WORKER_ENV must be explicitly configured as staging or prod" >&2; exit 1 ;;
esac

echo "==> Running database migrations"
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
liquibase \
  --url="jdbc:postgresql://$DB_HOST:$DB_PORT/${DB_NAME:-ONA}?sslmode=verify-full&sslrootcert=$SERVICE_DIR/certs/rds-global-bundle.pem" \
  --username="$DB_USER" \
  --password="$DB_PASSWORD" \
  --changeLogFile="$CHANGELOG_FILE" \
  --searchPath="$RELEASE_DIR/db" \
  update

if [ -n "$(get_env_value BOOTSTRAP_ADMIN_PASSWORD_PARAMETER)" ]; then
  echo "==> Ensuring bootstrap dashboard administrator"
  BOOTSTRAP_ADMIN_PASSWORD=$(get_secret_from_ssm BOOTSTRAP_ADMIN_PASSWORD_PARAMETER)
  BOOTSTRAP_ADMIN_USERNAME=$(get_env_value BOOTSTRAP_ADMIN_USERNAME) \
    BOOTSTRAP_ADMIN_EMAIL=$(get_env_value BOOTSTRAP_ADMIN_EMAIL) \
    BOOTSTRAP_ORGANIZATION_NAME=$(get_env_value BOOTSTRAP_ORGANIZATION_NAME) \
    BOOTSTRAP_ORGANIZATION_SLUG=$(get_env_value BOOTSTRAP_ORGANIZATION_SLUG) \
    BOOTSTRAP_PLATFORM_ADMIN=$(get_env_value BOOTSTRAP_PLATFORM_ADMIN) \
    BOOTSTRAP_ACCOUNT_MODE=$(get_env_value BOOTSTRAP_ACCOUNT_MODE) \
    BOOTSTRAP_ADMIN_PASSWORD="$BOOTSTRAP_ADMIN_PASSWORD" \
    DB_HOST="$DB_HOST" DB_PORT="$DB_PORT" DB_NAME="$DB_NAME" DB_USER="$DB_USER" DB_PASSWORD="$DB_PASSWORD" \
    DB_SSL=true DB_SSL_CA="$SERVICE_DIR/certs/rds-global-bundle.pem" \
    node "$RELEASE_DIR/deploy/bootstrap-admin.js"
  unset BOOTSTRAP_ADMIN_PASSWORD
fi

CLAIMING_WAS_ENABLED=$(cd "$RELEASE_DIR/api" && node - <<'NODE'
require('dotenv').config({path:'.env.prod'});
const {Pool}=require('pg');
const pool=new Pool({user:process.env.DB_USER,password:process.env.DB_PASSWORD,host:process.env.DB_HOST,port:process.env.DB_PORT,database:process.env.DB_NAME||'ONA',ssl:process.env.DB_SSL==='true'?{ca:process.env.DB_SSL_CA?require('fs').readFileSync(process.env.DB_SSL_CA,'utf8'):undefined,rejectUnauthorized:Boolean(process.env.DB_SSL_CA)}:undefined});
pool.query('SELECT claiming_enabled FROM email_worker_control WHERE environment=$1',[process.env.EMAIL_WORKER_ENV]).then((r)=>process.stdout.write(r.rows[0]?.claiming_enabled?'true':'false')).finally(()=>pool.end());
NODE
)
if [ "$CLAIMING_WAS_ENABLED" = true ]; then
  echo "==> Pausing email claims for release handoff"
  (cd "$RELEASE_DIR/api" && EMAIL_WORKER_ENV="$WORKER_ENV" NODE_ENV=prod node ../deploy/set-email-claiming.js false release-handoff)
fi

echo "==> Activating release"
chown -R ubuntu:ubuntu "$RELEASE_DIR"
ACTIVATED=false
HANDOFF_REENABLED=false
restore_previous_release() {
  local status=$?
  if [ "$status" -ne 0 ] && [ -n "$PREVIOUS_RELEASE" ] && [ -d "$PREVIOUS_RELEASE" ]; then
    echo "!! Restoring previous release $PREVIOUS_RELEASE" >&2
    set +e
    if [ "$ACTIVATED" = true ]; then ln -sfn "$PREVIOUS_RELEASE" "$SERVICE_DIR/current"; fi
    REVISION=$(cat "$PREVIOUS_RELEASE/REVISION" 2>/dev/null || basename "$PREVIOUS_RELEASE")
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
    if [ "$CLAIMING_WAS_ENABLED" = true ]; then
      if [ -f "$PREVIOUS_RELEASE/deploy/set-email-claiming.js" ]; then
        (cd "$PREVIOUS_RELEASE/api" && EMAIL_WORKER_ENV="$WORKER_ENV" EXPECTED_RELEASE_REVISION="$REVISION" NODE_ENV=prod node ../deploy/set-email-claiming.js true failed-release-restore)
      fi
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
  if curl -fsS http://localhost:3000/health >/dev/null 2>&1; then
    if (cd "$RELEASE_DIR/api" && EXPECTED_REVISION="$REVISION" EXPECTED_WORKER_ENV="$WORKER_ENV" EXPECTED_DEPLOYMENT_ID="$DEPLOYMENT_ID" node - <<'NODE'
require('dotenv-flow').config();
const { Pool } = require('pg');
const pool = new Pool({ user:process.env.DB_USER,password:process.env.DB_PASSWORD,host:process.env.DB_HOST,port:process.env.DB_PORT,database:process.env.DB_NAME||'ONA',ssl:process.env.DB_SSL==='true'?{ca:process.env.DB_SSL_CA?require('fs').readFileSync(process.env.DB_SSL_CA,'utf8'):undefined,rejectUnauthorized:Boolean(process.env.DB_SSL_CA)}:undefined });
pool.query(`SELECT 1 FROM email_worker_heartbeats h JOIN email_worker_control c USING(environment) WHERE h.environment=$2 AND h.release_revision=$1 AND h.worker_instance LIKE $3||'/%' AND h.enabled=true AND h.claiming=c.claiming_enabled AND h.heartbeat_at>now()-interval '45 seconds' LIMIT 1`,[process.env.EXPECTED_REVISION,process.env.EXPECTED_WORKER_ENV,process.env.EXPECTED_DEPLOYMENT_ID]).then((r)=>{process.exitCode=r.rowCount?0:1;}).catch(()=>{process.exitCode=1;}).finally(()=>pool.end());
NODE
    ); then
      if [ "$CLAIMING_WAS_ENABLED" = true ] && [ "$HANDOFF_REENABLED" = false ]; then
        echo "==> Fencing email claims to release $REVISION"
        (cd "$RELEASE_DIR/api" && EMAIL_WORKER_ENV="$WORKER_ENV" EXPECTED_RELEASE_REVISION="$REVISION" NODE_ENV=prod node ../deploy/set-email-claiming.js true release-handoff-complete)
        HANDOFF_REENABLED=true
        sleep 2
        continue
      fi
      echo "==> Deploy of $REVISION succeeded (API and worker healthy)"
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
exit 1

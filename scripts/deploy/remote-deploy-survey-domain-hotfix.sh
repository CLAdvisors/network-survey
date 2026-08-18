#!/usr/bin/env bash
# Installs the production survey-domain API hotfix without running database
# migrations, rebuilding frontends, or changing infrastructure.
set -euo pipefail

SOURCE_DIR=${1:?usage: remote-deploy-survey-domain-hotfix.sh <extracted-artifact-dir>}
SERVICE_DIR=/opt/service
PM2_APP=ona-api

source "$SERVICE_DIR/deploy.env"
export AWS_DEFAULT_REGION

REVISION=$(cat "$SOURCE_DIR/REVISION")
PREVIOUS_RELEASE=$(readlink -f "$SERVICE_DIR/current" 2>/dev/null || true)
RELEASE_DIR="$SERVICE_DIR/releases/$REVISION"
if [ -e "$RELEASE_DIR" ] || [ "$RELEASE_DIR" = "$PREVIOUS_RELEASE" ]; then
  RELEASE_DIR="$SERVICE_DIR/releases/${REVISION}-hotfix-$(date +%s)-$$"
fi
ACTIVATED=false

run_pm2() {
  sudo -u ubuntu -H env NODE_ENV=prod PM2_HOME=/home/ubuntu/.pm2 pm2 "$@"
}

start_release() {
  local release_path="$1"
  run_pm2 delete "$PM2_APP" >/dev/null 2>&1 || true
  run_pm2 start "$release_path/api/server.js" --name "$PM2_APP" --cwd "$release_path/api"
  run_pm2 save
}

restore_previous_release() {
  local status=$?
  if [ "$status" -ne 0 ] && [ "$ACTIVATED" = true ] && [ -n "$PREVIOUS_RELEASE" ] && [ -d "$PREVIOUS_RELEASE" ]; then
    echo "!! Restoring previous API release after hotfix activation failure" >&2
    set +e
    ln -sfn "$PREVIOUS_RELEASE" "$SERVICE_DIR/current"
    start_release "$PREVIOUS_RELEASE"
    for _ in $(seq 1 15); do
      if curl -fsS http://localhost:3000/health >/dev/null 2>&1; then
        echo "!! Previous API release restored" >&2
        break
      fi
      sleep 2
    done
    set -e
  fi
  exit "$status"
}
trap restore_previous_release EXIT

echo "==> Installing survey-domain hotfix $REVISION"
rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"
cp -a "$SOURCE_DIR/api" "$SOURCE_DIR/deploy" "$RELEASE_DIR/"
printf '%s\n' "$REVISION" > "$RELEASE_DIR/REVISION"

(cd "$RELEASE_DIR/api" && npm ci --omit=dev)

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
  aws ssm get-parameter --name "$parameter_name" --with-decryption --query 'Parameter.Value' --output text
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

append_secret_from_ssm DB_PASSWORD DB_PASSWORD_PARAMETER
append_secret_from_ssm SESSION_SECRET SESSION_SECRET_PARAMETER
append_secret_from_ssm RESEND_API_KEY RESEND_API_KEY_PARAMETER

# Refuse activation unless Terraform has published the reviewed canonical and
# legacy-origin configuration. Do not print either tokenized links or secrets.
[ "$(get_env_value SURVEY_URL)" = "https://survey.cladvisorsurveys.com" ] || {
  echo "Refusing hotfix activation: unexpected SURVEY_URL" >&2
  exit 1
}
case ",$(get_env_value SURVEY_ALLOWED_ORIGINS)," in
  *,https://demo.ona.survey.bennetts.work,*) ;;
  *) echo "Refusing hotfix activation: legacy survey origin is not configured" >&2; exit 1 ;;
esac

echo "==> Activating survey-domain hotfix"
chown -R ubuntu:ubuntu "$RELEASE_DIR"
ln -sfn "$RELEASE_DIR" "$SERVICE_DIR/current"
ACTIVATED=true

run_pm2 delete my-service >/dev/null 2>&1 || true
start_release "$RELEASE_DIR"

LOCAL_HEALTHY=false
for _ in $(seq 1 15); do
  if curl -fsS http://localhost:3000/health >/dev/null 2>&1; then
    LOCAL_HEALTHY=true
    break
  fi
  sleep 2
done
if [ "$LOCAL_HEALTHY" != true ]; then
  echo "!! Survey-domain hotfix failed its local health check; inspect logs on-instance" >&2
  exit 1
fi

# Keep the automatic rollback armed until public API, edge routing, TLS, and
# exact CORS behavior all pass. These checks use no respondent/demo tokens.
API_ORIGIN=https://demo.ona.api.bennetts.work
CANONICAL_ORIGIN=https://survey.cladvisorsurveys.com
LEGACY_ORIGIN=https://demo.ona.survey.bennetts.work
curl -fsS "$API_ORIGIN/health" | grep -q '"database":"ok"'
curl -fsS -o /dev/null "$CANONICAL_ORIGIN/"
curl -fsS -o /dev/null "$LEGACY_ORIGIN/"
for origin in "$CANONICAL_ORIGIN" "$LEGACY_ORIGIN"; do
  headers=$(mktemp)
  curl -fsS -o /dev/null -D "$headers" -X OPTIONS "$API_ORIGIN/api/questions" \
    -H "Origin: $origin" \
    -H 'Access-Control-Request-Method: GET'
  grep -Fqi "access-control-allow-origin: $origin" "$headers"
  rm -f "$headers"
done

echo "==> Survey-domain hotfix $REVISION passed local and external checks"
ls -1dt "$SERVICE_DIR"/releases/* | tail -n +6 | xargs -r rm -rf
trap - EXIT
exit 0

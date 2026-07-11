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

source "$SERVICE_DIR/deploy.env"
export AWS_DEFAULT_REGION

REVISION=$(cat "$SOURCE_DIR/REVISION")
RELEASE_DIR="$SERVICE_DIR/releases/$REVISION"

run_pm2() {
  sudo -u ubuntu -H env NODE_ENV=prod PM2_HOME=/home/ubuntu/.pm2 pm2 "$@"
}

echo "==> Installing release $REVISION to $RELEASE_DIR"
rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"
cp -a "$SOURCE_DIR/api" "$SOURCE_DIR/db" "$RELEASE_DIR/"

echo "==> Installing production dependencies"
(cd "$RELEASE_DIR/api" && npm ci --omit=dev)

echo "==> Fetching runtime config"
aws s3 cp "s3://$CONFIG_BUCKET/configs/.env.prod" "$RELEASE_DIR/api/.env.prod"
chmod 600 "$RELEASE_DIR/api/.env.prod"

echo "==> Running database migrations"
# Liquibase runs from this host because the database only accepts
# connections from the backend security group.
DB_HOST=$(grep '^DB_HOST=' "$RELEASE_DIR/api/.env.prod" | cut -d= -f2-)
DB_PORT=$(grep '^DB_PORT=' "$RELEASE_DIR/api/.env.prod" | cut -d= -f2-)
DB_NAME=$(grep '^DB_NAME=' "$RELEASE_DIR/api/.env.prod" | cut -d= -f2-)
DB_USER=$(grep '^DB_USER=' "$RELEASE_DIR/api/.env.prod" | cut -d= -f2-)
DB_PASSWORD=$(grep '^DB_PASSWORD=' "$RELEASE_DIR/api/.env.prod" | cut -d= -f2-)
# changeLogFile must stay "changelogs/..." — that path is the changeset
# identity recorded in DATABASECHANGELOG by all prior runs (local dev and the
# old liquibase-prod.sh both ran from db/). Changing it would make Liquibase
# re-run every migration.
liquibase \
  --url="jdbc:postgresql://$DB_HOST:$DB_PORT/${DB_NAME:-ONA}?sslmode=verify-full&sslrootcert=$SERVICE_DIR/certs/rds-global-bundle.pem" \
  --username="$DB_USER" \
  --password="$DB_PASSWORD" \
  --changeLogFile=changelogs/master-changelog.xml \
  --searchPath="$RELEASE_DIR/db" \
  update

echo "==> Activating release"
chown -R ubuntu:ubuntu "$RELEASE_DIR"
ln -sfn "$RELEASE_DIR" "$SERVICE_DIR/current"

# Drop the legacy cloud-init-era process name if it is still around
run_pm2 delete my-service >/dev/null 2>&1 || true

if run_pm2 describe "$PM2_APP" >/dev/null 2>&1; then
  run_pm2 restart "$PM2_APP" --update-env
else
  run_pm2 start "$SERVICE_DIR/current/api/server.js" --name "$PM2_APP" --cwd "$SERVICE_DIR/current/api"
fi
run_pm2 save

echo "==> Waiting for health check"
for i in $(seq 1 15); do
  if curl -fsS http://localhost:3000/health >/dev/null 2>&1; then
    echo "==> Deploy of $REVISION succeeded"
    # Keep the five most recent releases
    ls -1dt "$SERVICE_DIR"/releases/* | tail -n +6 | xargs -r rm -rf
    exit 0
  fi
  sleep 2
done

echo "!! Health check failed after deploy of $REVISION" >&2
run_pm2 logs "$PM2_APP" --nostream --lines 50 || true
exit 1

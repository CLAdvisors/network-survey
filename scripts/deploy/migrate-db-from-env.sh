#!/usr/bin/env bash
# One-off DB migration helper intended to run on the target EC2 instance via SSM.
# It dumps the current/source Postgres DB and restores into the target DB from
# the target release's runtime config.
#
# Usage on target instance:
#   SOURCE_DB_HOST=... SOURCE_DB_PORT=5432 SOURCE_DB_NAME=ONA \
#   SOURCE_DB_USER=... SOURCE_DB_PASSWORD=... \
#   TARGET_ENV_FILE=/opt/service/current/api/.env.prod \
#   bash scripts/deploy/migrate-db-from-env.sh
#
# Notes:
# - Requires postgresql-client on the instance.
# - The target DB is private, so this runs inside the target VPC.
# - The source DB is expected to be reachable from the target instance.
# - This script intentionally does not persist source credentials.
set -euo pipefail

SOURCE_DB_HOST=${SOURCE_DB_HOST:?SOURCE_DB_HOST is required}
SOURCE_DB_PORT=${SOURCE_DB_PORT:-5432}
SOURCE_DB_NAME=${SOURCE_DB_NAME:-ONA}
SOURCE_DB_USER=${SOURCE_DB_USER:?SOURCE_DB_USER is required}
SOURCE_DB_PASSWORD=${SOURCE_DB_PASSWORD:?SOURCE_DB_PASSWORD is required}
TARGET_ENV_FILE=${TARGET_ENV_FILE:-/opt/service/current/api/.env.prod}
DUMP_FILE=${DUMP_FILE:-/tmp/network-survey-prod-migration.dump}

if [ ! -f "$TARGET_ENV_FILE" ]; then
  echo "Target env file not found: $TARGET_ENV_FILE" >&2
  exit 1
fi

get_env() {
  grep "^$1=" "$TARGET_ENV_FILE" | tail -n 1 | cut -d= -f2-
}

TARGET_DB_HOST=$(get_env DB_HOST)
TARGET_DB_PORT=$(get_env DB_PORT)
TARGET_DB_NAME=$(get_env DB_NAME)
TARGET_DB_USER=$(get_env DB_USER)
TARGET_DB_PASSWORD=$(get_env DB_PASSWORD)
TARGET_DB_SSL_CA=$(get_env DB_SSL_CA || true)
TARGET_DB_NAME=${TARGET_DB_NAME:-ONA}
TARGET_DB_PORT=${TARGET_DB_PORT:-5432}

cleanup() {
  rm -f "$DUMP_FILE"
}
trap cleanup EXIT

echo "==> Dumping source database $SOURCE_DB_HOST:$SOURCE_DB_PORT/$SOURCE_DB_NAME"
PGPASSWORD="$SOURCE_DB_PASSWORD" pg_dump \
  --host="$SOURCE_DB_HOST" \
  --port="$SOURCE_DB_PORT" \
  --username="$SOURCE_DB_USER" \
  --dbname="$SOURCE_DB_NAME" \
  --format=custom \
  --no-owner \
  --no-acl \
  --file="$DUMP_FILE"

RESTORE_SSLMODE=require
if [ -n "${TARGET_DB_SSL_CA:-}" ] && [ -f "$TARGET_DB_SSL_CA" ]; then
  RESTORE_SSLMODE=verify-full
fi

echo "==> Restoring into target database $TARGET_DB_HOST:$TARGET_DB_PORT/$TARGET_DB_NAME"
PGPASSWORD="$TARGET_DB_PASSWORD" pg_restore \
  --host="$TARGET_DB_HOST" \
  --port="$TARGET_DB_PORT" \
  --username="$TARGET_DB_USER" \
  --dbname="$TARGET_DB_NAME" \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  --verbose \
  "$DUMP_FILE"

echo "==> Migration restore complete"

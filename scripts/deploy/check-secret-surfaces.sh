#!/usr/bin/env bash
# Read-only, output paths and counts only. Run on a host only after operator
# approval; never print, copy or hash a credential's content.
set -euo pipefail
ROOT=${1:?usage: check-secret-surfaces.sh <explicit-private-test-root-or-approved-host-root>}
test -d "$ROOT" || { echo 'Scan root is not a directory' >&2; exit 2; }
shopt -s nullglob
hits=0
check_file() {
  local file=$1 pattern=$2
  if [ -f "$file" ] && grep -aqE "$pattern" "$file"; then
    printf 'credential-pattern present: %s\n' "${file#"$ROOT"}"
    hits=$((hits + 1))
  fi
}
env_pattern='(^|[[:space:]"{,])(DB_PASSWORD|SESSION_SECRET|RESEND_API_KEY|RESEND_KEY|RESEND_WEBHOOK_SECRET|RESEND_WEBHOOK_PREVIOUS_SECRET|AWS_SECRET_ACCESS_KEY)[[:space:]"=:]+'
# Files are limited to the network-survey service and its PM2 operator.
for file in "$ROOT"/opt/service/releases/*/api/.env* "$ROOT"/opt/service/current/api/.env* \
  "$ROOT"/opt/service/backups/*/api/.env* "$ROOT"/opt/service/previous/api/.env*; do
  case "$file" in *.example) continue ;; esac # tracked local template, not host runtime
  check_file "$file" "$env_pattern"
done
for file in "$ROOT"/home/ubuntu/.pm2/dump.pm2 "$ROOT"/home/ubuntu/.pm2/dump.pm2.bak \
  "$ROOT"/home/ubuntu/.bash_history "$ROOT"/root/.bash_history \
  "$ROOT"/var/log/cloud-init-output.log "$ROOT"/var/log/cloud-init.log \
  "$ROOT"/home/ubuntu/.pm2/logs/*.log \
  "$ROOT"/var/lib/cloud/instances/*/user-data.txt; do
  check_file "$file" "$env_pattern"
done
printf 'files with credential-name patterns: %s\n' "$hits"
test "$hits" -eq 0

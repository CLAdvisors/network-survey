#!/bin/bash
# Runs from ona-security-upgrades.service. Default Ubuntu apt timers are masked.
set -euo pipefail

LOG_FILE=/var/log/ona-security-upgrades.log
STATUS_FILE=/var/lib/ona-bootstrap/security-upgrade-status.json
mkdir -p /var/lib/ona-bootstrap
touch "$LOG_FILE"
chmod 0640 "$LOG_FILE"
exec > >(tee -a "$LOG_FILE") 2>&1

started_at=$(date --utc +%FT%TZ)
printf '{"status":"running","started_at":"%s"}\n' "$started_at" > "$STATUS_FILE"

on_error() {
  local exit_code=$1
  trap - ERR TERM INT
  printf '{"status":"failed","started_at":"%s","finished_at":"%s","exit_code":%d}\n' \
    "$started_at" "$(date --utc +%FT%TZ)" "$exit_code" > "$STATUS_FILE"
  echo "ONA_SECURITY_UPGRADE_FAILED exit_code=$exit_code" >&2
  exit "$exit_code"
}
trap 'on_error "$?"' ERR
trap 'on_error 124' TERM INT

echo "ONA_SECURITY_UPGRADE_STARTED at=$started_at"
: "${TARGET_GROUP_ARN:?TARGET_GROUP_ARN is required}"
healthy_targets=$(timeout --signal=TERM --kill-after=5s 30s \
  aws elbv2 describe-target-health --target-group-arn "$TARGET_GROUP_ARN" \
    --query 'length(TargetHealthDescriptions[?TargetHealth.State==`healthy`])' --output text)
[ "$healthy_targets" -ge 2 ] || {
  echo "Refusing security upgrade with only $healthy_targets healthy target(s)" >&2
  exit 1
}
curl -fsS --connect-timeout 2 --max-time 5 http://localhost:3000/health >/dev/null
/usr/local/sbin/ona-apt update
# unattended-upgrade applies only origins allowed by Ubuntu's reviewed policy.
# Keep it low priority and bounded so package-repository trouble cannot starve
# the API indefinitely. Reboots remain an explicit rolling operator action.
timeout --signal=TERM --kill-after=30s 600s \
  nice -n 15 ionice -c 3 unattended-upgrade --verbose
curl -fsS --connect-timeout 2 --max-time 10 http://localhost:3000/health >/dev/null

finished_at=$(date --utc +%FT%TZ)
printf '{"status":"succeeded","started_at":"%s","finished_at":"%s"}\n' \
  "$started_at" "$finished_at" > "$STATUS_FILE"
echo "ONA_SECURITY_UPGRADE_SUCCEEDED at=$finished_at"

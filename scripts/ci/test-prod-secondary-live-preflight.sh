#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/aws" <<'AWS'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$MOCK_AWS_LOG"
case "$1 $2" in
  "autoscaling describe-auto-scaling-groups")
    if [[ "$*" == *TargetGroupARNs* ]]; then printf 'tg-arn\n'; else printf 'i-one\ti-two\n'; fi ;;
  "elbv2 describe-target-groups") printf '%s\n' "${MOCK_HEALTH_PATH:-/health}" ;;
  "elbv2 describe-target-health")
    if [ "${MOCK_MISMATCH:-false}" = true ]; then printf 'i-one\n'; else printf 'i-one\ti-two\n'; fi ;;
  "ssm send-command") printf 'command-1\n' ;;
  "ssm wait") ;;
  "ssm get-command-invocation") printf 'Success\n' ;;
  *) echo "unexpected aws invocation: $*" >&2; exit 2 ;;
esac
AWS
chmod +x "$TMP/aws"
export PATH="$TMP:$PATH" MOCK_AWS_LOG="$TMP/aws.log"
"$ROOT/scripts/deploy/verify-prod-secondary-live-targets.sh" reviewed-asg >/dev/null
grep -q 'ssm send-command' "$MOCK_AWS_LOG"
grep -q -- '--instance-ids i-one i-two' "$MOCK_AWS_LOG"
if MOCK_MISMATCH=true "$ROOT/scripts/deploy/verify-prod-secondary-live-targets.sh" reviewed-asg >/dev/null 2>&1; then
  echo 'preflight accepted a target/ASG mismatch during migration' >&2
  exit 1
fi

# Once the target group already uses /live, recovery applies must not depend on
# current instance count, target registration, or SSM/process health.
: > "$MOCK_AWS_LOG"
MOCK_HEALTH_PATH=/live MOCK_MISMATCH=true \
  "$ROOT/scripts/deploy/verify-prod-secondary-live-targets.sh" reviewed-asg >/dev/null
grep -q 'elbv2 describe-target-groups' "$MOCK_AWS_LOG"
if grep -qE 'describe-target-health|ssm send-command' "$MOCK_AWS_LOG"; then
  echo 'already-migrated recovery path performed an all-target proof' >&2
  exit 1
fi

echo 'prod-secondary /live migration and recovery preflight contracts validated'

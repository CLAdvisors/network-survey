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
    if [[ "$*" == *TargetGroupARNs* ]]; then printf '%s\n' "${MOCK_ATTACHED_TG:-tg-arn}"; else printf 'i-one\ti-two\n'; fi ;;
  "elbv2 describe-target-health")
    if [ "${MOCK_MISMATCH:-false}" = true ]; then printf 'i-one\n'; else printf 'i-one\ti-two\n'; fi ;;
  "ssm send-command") printf 'command-1\n' ;;
  "ssm wait") ;;
  "ssm get-command-invocation") printf 'Success\n' ;;
  *) echo "unexpected aws invocation: $*" >&2; exit 2 ;;
esac
AWS
chmod +x "$TMP/aws"
cat > "$TMP/terraform" <<'TERRAFORM'
#!/usr/bin/env bash
set -euo pipefail
case "$*" in
  "state show -no-color module.platform.aws_autoscaling_group.app")
    printf '%s\n' '    name                      = "reviewed-asg"' ;;
  "state show -no-color module.platform.aws_lb_target_group.api")
    printf '%s\n' '    arn                       = "arn:aws:elasticloadbalancing:us-east-1:710054969994:targetgroup/reviewed/123"' ;;
  *) echo "unexpected terraform invocation: $*" >&2; exit 2 ;;
esac
TERRAFORM
chmod +x "$TMP/terraform"
export PATH="$TMP:$PATH" MOCK_AWS_LOG="$TMP/aws.log"

# State attributes use aligned whitespace in real Terraform output. Ensure the
# workflow helper returns exact values rather than depending on one-space ` = `.
STATE_READER="$ROOT/scripts/deploy/read-terraform-state-attribute.sh"
[ "$("$STATE_READER" 'module.platform.aws_autoscaling_group.app' name)" = reviewed-asg ]
[ "$("$STATE_READER" 'module.platform.aws_lb_target_group.api' arn)" = 'arn:aws:elasticloadbalancing:us-east-1:710054969994:targetgroup/reviewed/123' ]

# Migration-required phase proves exactly the Terraform-state-bound ASG/TG and
# every current target using the deploy role.
"$ROOT/scripts/deploy/verify-prod-secondary-live-targets.sh" reviewed-asg tg-arn >/dev/null
grep -q 'ssm send-command' "$MOCK_AWS_LOG"
grep -q -- '--instance-ids i-one i-two' "$MOCK_AWS_LOG"
if MOCK_MISMATCH=true "$ROOT/scripts/deploy/verify-prod-secondary-live-targets.sh" reviewed-asg tg-arn >/dev/null 2>&1; then
  echo 'preflight accepted a target/ASG mismatch during migration' >&2
  exit 1
fi
if MOCK_ATTACHED_TG=unrelated-tg "$ROOT/scripts/deploy/verify-prod-secondary-live-targets.sh" reviewed-asg tg-arn >/dev/null 2>&1; then
  echo 'preflight accepted an ASG/TG identity different from Terraform state' >&2
  exit 1
fi

# Already-migrated recovery is decided under Terraform-role credentials and
# must not switch roles or run host/SSM proof.
WORKFLOW="$ROOT/.github/workflows/terraform-apply.yml"
grep -q 'read-terraform-state-attribute.sh' "$WORKFLOW"
grep -q 'aws elbv2 describe-target-groups' "$WORKFLOW"
grep -q "if \[ \"\$CURRENT_PATH\" = /live \]" "$WORKFLOW"
grep -q "migration_required=false" "$WORKFLOW"
grep -q 'No state-bound target group was resolved; no apply could have started.' "$WORKFLOW"
[ "$(grep -c "steps.live-migration.outputs.migration_required == 'true'" "$WORKFLOW")" -eq 3 ] || {
  echo 'deploy-role migration steps are not all gated by migration_required=true' >&2
  exit 1
}

# DescribeTargetGroups remains in the Terraform-role inspection phase so the
# first migration is not circular. The deploy policy still gains the permission
# for post-migration tooling after this apply has installed it.
! grep -q 'describe-target-groups' "$ROOT/scripts/deploy/verify-prod-secondary-live-targets.sh"
DEPLOY_POLICY=$(awk '/data "aws_iam_policy_document" "github_deploy"/{capture=1} capture{print} /resource "aws_iam_role_policy" "github_deploy"/{exit}' "$ROOT/terraform/modules/prod_secondary_platform/main.tf")
grep -q 'elasticloadbalancing:DescribeTargetGroups' <<<"$DEPLOY_POLICY"

echo 'prod-secondary /live migration, recovery, identity, and IAM contracts validated'

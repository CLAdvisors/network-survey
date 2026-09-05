#!/usr/bin/env bash
# Mechanical guard for the one-time /health -> /live target-group migration.
# Uses approved SSM execution so every currently registered ASG target must
# prove its local dependency-free endpoint before Terraform may change health.
set -euo pipefail

ASG_NAME=${1:?usage: verify-prod-secondary-live-targets.sh <asg-name>}

readarray -t ASG_INSTANCES < <(aws autoscaling describe-auto-scaling-groups \
  --auto-scaling-group-names "$ASG_NAME" \
  --query 'AutoScalingGroups[0].Instances[?LifecycleState==`InService` && HealthStatus==`Healthy`].InstanceId' \
  --output text | tr '\t' '\n' | sed '/^$/d' | sort)
readarray -t TARGET_GROUPS < <(aws autoscaling describe-auto-scaling-groups \
  --auto-scaling-group-names "$ASG_NAME" \
  --query 'AutoScalingGroups[0].TargetGroupARNs' --output text | tr '\t' '\n' | sed '/^$/d')

[ "${#ASG_INSTANCES[@]}" -ge 2 ] || { echo "Refusing /live migration: expected at least two healthy InService instances" >&2; exit 1; }
[ "${#TARGET_GROUPS[@]}" -eq 1 ] || { echo "Refusing /live migration: expected exactly one ASG target group" >&2; exit 1; }

readarray -t REGISTERED_TARGETS < <(aws elbv2 describe-target-health --target-group-arn "${TARGET_GROUPS[0]}" \
  --query 'TargetHealthDescriptions[?TargetHealth.State!=`draining`].Target.Id' \
  --output text | tr '\t' '\n' | sed '/^$/d' | sort)
[ "$(printf '%s\n' "${ASG_INSTANCES[@]}")" = "$(printf '%s\n' "${REGISTERED_TARGETS[@]}")" ] || {
  echo "Refusing /live migration: registered targets do not exactly match healthy InService ASG instances" >&2
  exit 1
}

PARAMETERS=$(jq -cn '{commands:["set -euo pipefail","test \"$(curl -fsS --connect-timeout 2 --max-time 5 http://localhost:3000/live)\" = '\''{\"status\":\"ok\",\"process\":\"live\"}'\''"]}')
COMMAND_ID=$(aws ssm send-command \
  --instance-ids "${REGISTERED_TARGETS[@]}" \
  --document-name AWS-RunShellScript \
  --comment 'Preflight dependency-free ALB /live migration' \
  --parameters "$PARAMETERS" \
  --query 'Command.CommandId' --output text)

for instance in "${REGISTERED_TARGETS[@]}"; do
  aws ssm wait command-executed --command-id "$COMMAND_ID" --instance-id "$instance"
  status=$(aws ssm get-command-invocation --command-id "$COMMAND_ID" --instance-id "$instance" --query Status --output text)
  [ "$status" = Success ] || { echo "Refusing /live migration: $instance returned SSM status $status" >&2; exit 1; }
done

echo "All ${#REGISTERED_TARGETS[@]} registered prod-secondary targets serve the dependency-free /live contract."

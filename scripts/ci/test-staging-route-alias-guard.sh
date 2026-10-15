#!/usr/bin/env bash
# Regression for the workflow-level staging alias bypass (primary QA I1).
#
# Extracts the actual fail-closed guard step (run + env) from deploy.yml and
# rollback-api.yml, renders the GitHub expressions for the case "dispatch
# production while the environment's TF_ENV variable is staging", and requires
# the guard to refuse before any AWS/OIDC step. It also checks a prod-consistent
# TF_ENV is still allowed. Offline; no AWS, no credentials.
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)

fail() {
  echo "not ok - $*" >&2
  exit 1
}

step_block() { # workflow step-name
  awk -v name="$2" '
    index($0, "- name: " name) > 0 { capture = 1 }
    capture && /^      - / && index($0, "- name: " name) == 0 { exit }
    capture { print }
  ' "$1"
}

render_production() {
  sed -e 's#\${{ inputs.environment }}#production#g' \
      -e "s#\${{ github.event_name == 'workflow_dispatch' && inputs.environment || 'staging' }}#production#g"
}

check_route() { # workflow route
  local workflow="$1" route="$2" block cmd rendered status

  block=$(step_block "$REPO_ROOT/$workflow" "Guard staging routes (fail-closed)")
  [ -n "$block" ] || fail "$workflow: no fail-closed guard step"

  grep -qF 'CONFIGURED_TF_ENV: ${{ vars.TF_ENV }}' <<<"$block" ||
    fail "$workflow: guard step does not pass the configured vars.TF_ENV"

  cmd=$(sed -n 's/^ *run: //p' <<<"$block" | head -n 1)
  case "$cmd" in
    *guard-staging-route.sh*) ;;
    *) fail "$workflow: guard step does not invoke guard-staging-route.sh" ;;
  esac

  rendered=$(printf '%s' "$cmd" | render_production)

  status=0
  ( cd "$REPO_ROOT" && CONFIGURED_TF_ENV=staging bash -c "$rendered" ) >/dev/null 2>&1 || status=$?
  [ "$status" -eq 1 ] ||
    fail "$workflow: $route production with TF_ENV=staging expected guard refusal (1), got $status"
  echo "ok - $workflow refuses $route production with TF_ENV=staging"

  status=0
  ( cd "$REPO_ROOT" && CONFIGURED_TF_ENV=prod bash -c "$rendered" ) >/dev/null 2>&1 || status=$?
  [ "$status" -eq 0 ] ||
    fail "$workflow: $route production with TF_ENV=prod expected guard allow (0), got $status"
  echo "ok - $workflow allows $route production with TF_ENV=prod"
}

check_route ".github/workflows/deploy.yml" deploy
check_route ".github/workflows/rollback-api.yml" rollback

echo 'staging route alias guard regression passed'

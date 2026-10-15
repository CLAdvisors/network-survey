#!/usr/bin/env bash
#
# Fail-closed staging route guard (code-only candidate).
#
# While the target-account staging environment (terraform/envs/staging-target)
# is not provisioned and no live route to it has been approved, every staging
# route must fail closed. This script is the single gate each GitHub workflow
# calls before it assumes any AWS OIDC role or reads Terraform state.
#
# It is a *candidate* guard: it does not by itself freeze live CI. The source
# staging deploy freeze becomes effective only when this change is separately
# approved and merged. This script does not call AWS, read state, or mutate
# anything.
#
# Usage: guard-staging-route.sh <route> <environment>
#   <route>       push | deploy | plan | apply | rollback
#   <environment> the resolved GitHub environment, or 'staging' for a main push
#
# Policy (fail closed):
#   staging-target         refused on every route: the target staging root is
#                          not provisioned, and no live plan/state read, apply
#                          or deploy to it is approved yet.
#   staging (legacy source) refused on mutating routes (push/deploy/apply/
#                          rollback): source deploy is frozen until the approved
#                          target cutover. Read-only plan stays allowed.
#   production|prod|prod-secondary
#                          unchanged; not part of the staging migration.
#   anything else          refused as unknown.
#
# Lifting any refusal requires a separately reviewed workflow/code change; there
# is intentionally no runtime bypass variable.
set -euo pipefail

route="${1:-}"
environment="${2:-}"

case "$route" in
  push | deploy | plan | apply | rollback) ;;
  *)
    echo "guard-staging-route: unknown route '${route}' (expected push|deploy|plan|apply|rollback)" >&2
    exit 2
    ;;
esac

if [ -z "$environment" ]; then
  echo "guard-staging-route: environment is required" >&2
  exit 2
fi

case "$environment" in
  staging-target)
    echo "Refusing ${route} route to 'staging-target': the target-account staging environment is not provisioned and no live plan, apply or deploy is approved." >&2
    exit 1
    ;;
  staging)
    case "$route" in
      plan)
        echo "Allowing read-only ${route} route to the legacy source staging root."
        ;;
      *)
        echo "Refusing ${route} route to the legacy source staging root: source deploy is frozen until the separately approved target staging cutover." >&2
        exit 1
        ;;
    esac
    ;;
  production | prod | prod-secondary)
    echo "Allowing ${route} route to ${environment}."
    ;;
  *)
    echo "Refusing ${route} route to unknown environment '${environment}'." >&2
    exit 1
    ;;
esac

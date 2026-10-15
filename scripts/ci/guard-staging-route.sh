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
# Usage: guard-staging-route.sh <route> <environment> [configured_tf_env]
#   <route>            push | deploy | plan | apply | rollback
#   <environment>      the resolved GitHub environment, or 'staging' for a main push
#   <configured_tf_env> the environment's TF_ENV repository variable, passed by the
#                      routes that let it select the resolved resource namespace
#                      (deploy, rollback). Empty when unset.
#
# Policy (fail closed):
#   staging-target         refused on every route: the target staging root is
#                          not provisioned, and no live plan/state read, apply
#                          or deploy to it is approved yet.
#   staging (legacy source) refused on every route (push/deploy/plan/apply/
#                          rollback): source deploy and source plan are frozen
#                          until the separately approved target cutover. The
#                          legacy root/state is preserved for future explicitly
#                          approved read-only operator procedures, but no
#                          automatic source-plan route is kept.
#   production|prod|prod-secondary
#                          unchanged; not part of the staging migration. A
#                          configured TF_ENV must match the route's namespace so
#                          a staging alias cannot select source-staging
#                          resources through a prod/production route.
#   anything else          refused as unknown.
#
# Lifting any refusal requires a separately reviewed workflow/code change; there
# is intentionally no runtime bypass variable.
set -euo pipefail

route="${1:-}"
environment="${2:-}"
configured_tf_env="${3:-}"

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

# A resolved TF_ENV selection must not alias a different environment's
# namespace. Without this, a non-staging route with a staging TF_ENV variable
# would pass the guard and then resolve source-staging buckets/hosts. This runs
# before any OIDC assumption.
if [ -n "$configured_tf_env" ]; then
  case "$environment" in
    production | prod) expected_tf_env=prod ;;
    prod-secondary) expected_tf_env=prod-secondary ;;
    staging) expected_tf_env=staging ;;
    staging-target) expected_tf_env=staging-target ;;
    *) expected_tf_env="" ;;
  esac
  if [ "$configured_tf_env" != "$expected_tf_env" ]; then
    echo "Refusing ${route} route to ${environment}: configured TF_ENV='${configured_tf_env}' does not match the required '${expected_tf_env}' namespace." >&2
    exit 1
  fi
fi

case "$environment" in
  staging-target)
    echo "Refusing ${route} route to 'staging-target': the target-account staging environment is not provisioned and no live plan, apply or deploy is approved." >&2
    exit 1
    ;;
  staging)
    echo "Refusing ${route} route to the legacy source staging root: source staging routes (including plan) are frozen until the separately approved target staging cutover." >&2
    exit 1
    ;;
  production | prod | prod-secondary)
    echo "Allowing ${route} route to ${environment}."
    ;;
  *)
    echo "Refusing ${route} route to unknown environment '${environment}'." >&2
    exit 1
    ;;
esac

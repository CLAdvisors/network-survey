#!/usr/bin/env bash
# Offline matrix test for the fail-closed staging route guard. No AWS, no
# network, no Terraform state. Run it with any HERDR_* variables removed.
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
GUARD="$REPO_ROOT/scripts/ci/guard-staging-route.sh"

fail() {
  echo "not ok - $*" >&2
  exit 1
}

run_guard() { # route environment
  GUARD_STATUS=0
  GUARD_OUTPUT=$("$GUARD" "$1" "$2" 2>&1) || GUARD_STATUS=$?
}

expect_allow() { # route environment
  run_guard "$1" "$2"
  [[ "$GUARD_STATUS" == 0 ]] || fail "$1/$2 expected allow, exited $GUARD_STATUS: $GUARD_OUTPUT"
  echo "ok - allow $1 $2"
}

expect_refuse() { # route environment
  run_guard "$1" "$2"
  [[ "$GUARD_STATUS" == 1 ]] || fail "$1/$2 expected refusal (1), exited $GUARD_STATUS: $GUARD_OUTPUT"
  echo "ok - refuse $1 $2"
}

# Target-account staging is fail-closed on every route.
for route in push deploy plan apply rollback; do
  expect_refuse "$route" staging-target
done

# Legacy source staging is frozen on every mutating route; read-only plan stays.
for route in push deploy apply rollback; do
  expect_refuse "$route" staging
done
expect_allow plan staging

# Prod/prod-secondary routes are untouched.
for environment in prod prod-secondary production; do
  for route in push deploy plan apply rollback; do
    expect_allow "$route" "$environment"
  done
done

# Unknown environments are refused.
expect_refuse deploy not-an-environment
expect_refuse plan staging-targets

# Unknown route and missing environment are usage errors.
run_guard bogus-route staging
[[ "$GUARD_STATUS" == 2 ]] || fail "unknown route expected exit 2, exited $GUARD_STATUS"
echo "ok - refuse unknown route"
run_guard deploy ""
[[ "$GUARD_STATUS" == 2 ]] || fail "missing environment expected exit 2, exited $GUARD_STATUS"
echo "ok - refuse missing environment"

# There is intentionally no runtime bypass variable to disable the freeze.
if grep -Eq 'BYPASS|OVERRIDE_FREEZE|ALLOW_STAGING|STAGING_ROUTE_ACK' "$GUARD"; then
  fail 'guard must not expose a runtime bypass variable'
fi
echo "ok - no runtime bypass variable"

echo 'staging route guard matrix passed'

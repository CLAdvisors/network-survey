#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
APT_HELPER="$REPO_ROOT/terraform/modules/prod_secondary_platform/apt-helper.sh"
TEST_TMP=$(mktemp -d)
trap 'rm -rf "$TEST_TMP"' EXIT

fail() {
  echo "not ok - $*" >&2
  exit 1
}

assert_contains() {
  local haystack=$1
  local needle=$2
  [[ "$haystack" == *"$needle"* ]] || fail "expected output to contain: $needle"
}

assert_log_line() {
  local log=$1
  local line=$2
  grep -Fqx -- "$line" "$log" || fail "expected log line: $line"
}

assert_log_count() {
  local log=$1
  local line=$2
  local expected=$3
  local actual
  actual=$(grep -Fxc -- "$line" "$log" || true)
  [[ "$actual" == "$expected" ]] || fail "expected $expected occurrences of '$line', got $actual"
}

make_fixture() {
  local name=$1
  CASE_DIR="$TEST_TMP/$name"
  APT_ROOT="$CASE_DIR/root"
  MOCK_LOG="$CASE_DIR/calls.log"
  MOCK_STATE="$CASE_DIR/state"
  mkdir -p "$APT_ROOT/etc/apt/sources.list.d" "$APT_ROOT/var/lib/apt/lists/partial" "$CASE_DIR/bin" "$MOCK_STATE"
  : >"$MOCK_LOG"
  cat >"$APT_ROOT/etc/apt/sources.list" <<'EOF'
deb http://security.ubuntu.com/ubuntu jammy-security main
deb https://archive.ubuntu.com/ubuntu/ jammy main
EOF
  cat >"$APT_ROOT/etc/apt/sources.list.d/ubuntu.sources" <<'EOF'
Types: deb
URIs: http://archive.ubuntu.com/ubuntu
Suites: jammy-updates
Components: main
EOF
  touch "$APT_ROOT/var/lib/apt/lists/partial/stale-index"

  cat >"$CASE_DIR/bin/apt-get" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
mirror=archive.ubuntu.com
grep -q 'us\.archive\.ubuntu\.com' "$ONA_APT_ROOT/etc/apt/sources.list" && mirror=us.archive.ubuntu.com
printf 'apt|%s|%s\n' "$mirror" "$*" >>"$MOCK_LOG"
if [[ "$*" == '-q update' ]]; then
  case "$MOCK_SCENARIO" in
    fallback)
      if [[ "$mirror" == archive.ubuntu.com ]]; then exit 1; fi
      ;;
    all-mirrors-fail) exit 1 ;;
  esac
fi
EOF
  cat >"$CASE_DIR/bin/dpkg" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
mirror=archive.ubuntu.com
grep -q 'us\.archive\.ubuntu\.com' "$ONA_APT_ROOT/etc/apt/sources.list" && mirror=us.archive.ubuntu.com
printf 'dpkg|%s|%s\n' "$mirror" "$*" >>"$MOCK_LOG"
if [[ "$*" == '--configure -a' && "$MOCK_SCENARIO" == recovery ]]; then
  count_file="$MOCK_STATE/configure-count"
  count=0
  [[ ! -f "$count_file" ]] || read -r count <"$count_file"
  count=$((count + 1))
  printf '%s\n' "$count" >"$count_file"
  [[ "$count" != 1 ]] || exit 124
fi
if [[ "$*" == '--audit' && "$MOCK_SCENARIO" == audit-failure ]]; then
  echo 'package remains unconfigured'
fi
if [[ "$*" == '--audit' && "$MOCK_SCENARIO" == audit-command-failure ]]; then
  exit 2
fi
EOF
  chmod +x "$CASE_DIR/bin/apt-get" "$CASE_DIR/bin/dpkg"
}

run_helper() {
  local scenario=$1
  shift
  set +e
  CASE_OUTPUT=$(env \
    ONA_APT_ROOT="$APT_ROOT" \
    ONA_APT_GET="$CASE_DIR/bin/apt-get" \
    ONA_DPKG="$CASE_DIR/bin/dpkg" \
    ONA_APT_LOCK="$CASE_DIR/apt.lock" \
    MOCK_SCENARIO="$scenario" \
    MOCK_LOG="$MOCK_LOG" \
    MOCK_STATE="$MOCK_STATE" \
    bash "$APT_HELPER" "$@" 2>&1)
  CASE_STATUS=$?
  set -e
}

make_fixture primary-success
run_helper success install curl jq
[[ "$CASE_STATUS" == 0 ]] || fail "primary success exited $CASE_STATUS: $CASE_OUTPUT"
assert_contains "$CASE_OUTPUT" 'apt: install succeeded with mirror archive.ubuntu.com'
assert_log_line "$MOCK_LOG" 'apt|archive.ubuntu.com|-q update'
assert_log_line "$MOCK_LOG" 'apt|archive.ubuntu.com|-q -y --no-install-recommends --fix-broken install'
assert_log_line "$MOCK_LOG" 'apt|archive.ubuntu.com|-q -y --no-install-recommends --download-only install curl jq'
assert_log_line "$MOCK_LOG" 'apt|archive.ubuntu.com|-q -y --no-install-recommends --no-download install curl jq'
assert_log_line "$MOCK_LOG" 'dpkg|archive.ubuntu.com|--audit'
[[ ! -e "$APT_ROOT/var/lib/apt/lists/partial/stale-index" ]] || fail 'partial indexes were not cleared'
grep -Fq 'http://archive.ubuntu.com/ubuntu' "$APT_ROOT/etc/apt/sources.list.d/ubuntu.sources" || fail 'deb822 source was not rewritten'
echo 'ok - primary success'

make_fixture archive-fallback
run_helper fallback update
[[ "$CASE_STATUS" == 0 ]] || fail "fallback exited $CASE_STATUS: $CASE_OUTPUT"
assert_contains "$CASE_OUTPUT" 'apt: bounded update attempt failed with mirror archive.ubuntu.com'
assert_contains "$CASE_OUTPUT" 'apt: update succeeded with mirror us.archive.ubuntu.com'
assert_log_line "$MOCK_LOG" 'apt|archive.ubuntu.com|-q update'
assert_log_line "$MOCK_LOG" 'apt|us.archive.ubuntu.com|-q update'
grep -Fq 'http://us.archive.ubuntu.com/ubuntu' "$APT_ROOT/etc/apt/sources.list" || fail 'fallback mirror was not configured'
echo 'ok - archive failure then us fallback'

make_fixture interrupted-configure
run_helper recovery update
[[ "$CASE_STATUS" == 0 ]] || fail "dpkg recovery exited $CASE_STATUS: $CASE_OUTPUT"
assert_log_count "$MOCK_LOG" 'dpkg|archive.ubuntu.com|--configure -a' 2
assert_log_line "$MOCK_LOG" 'dpkg|archive.ubuntu.com|--audit'
assert_contains "$CASE_OUTPUT" 'apt: update succeeded with mirror archive.ubuntu.com'
echo 'ok - interrupted first dpkg configure recovery'

make_fixture audit-failure
run_helper audit-failure update
[[ "$CASE_STATUS" == 1 ]] || fail "audit failure exited $CASE_STATUS instead of 1: $CASE_OUTPUT"
assert_log_line "$MOCK_LOG" 'dpkg|archive.ubuntu.com|--audit'
assert_log_line "$MOCK_LOG" 'dpkg|us.archive.ubuntu.com|--audit'
assert_contains "$CASE_OUTPUT" 'apt: all approved mirrors failed for update'
echo 'ok - audit output failure'

make_fixture audit-command-failure
run_helper audit-command-failure update
[[ "$CASE_STATUS" == 1 ]] || fail "audit command failure exited $CASE_STATUS instead of 1: $CASE_OUTPUT"
assert_log_line "$MOCK_LOG" 'dpkg|archive.ubuntu.com|--audit'
assert_log_line "$MOCK_LOG" 'dpkg|us.archive.ubuntu.com|--audit'
assert_contains "$CASE_OUTPUT" 'apt: all approved mirrors failed for update'
echo 'ok - audit command failure'

make_fixture all-mirrors-fail
run_helper all-mirrors-fail update
[[ "$CASE_STATUS" == 1 ]] || fail "all-mirror failure exited $CASE_STATUS instead of 1: $CASE_OUTPUT"
assert_log_line "$MOCK_LOG" 'apt|archive.ubuntu.com|-q update'
assert_log_line "$MOCK_LOG" 'apt|us.archive.ubuntu.com|-q update'
if grep -Fq -- '--fix-broken install' "$MOCK_LOG"; then
  fail 'apt continued after a failed mirror update'
fi
assert_contains "$CASE_OUTPUT" 'apt: all approved mirrors failed for update'
echo 'ok - all mirrors failing'

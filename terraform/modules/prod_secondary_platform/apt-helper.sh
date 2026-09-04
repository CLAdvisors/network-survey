#!/bin/bash
# Bounded, rerunnable apt operations for prod-secondary hosts.
set -euo pipefail

APT_MIRRORS=(archive.ubuntu.com us.archive.ubuntu.com)
APT_SOURCES=(/etc/apt/sources.list)
while IFS= read -r source_file; do
  APT_SOURCES+=("$source_file")
done < <(find /etc/apt/sources.list.d -maxdepth 1 -type f \( -name '*.list' -o -name '*.sources' \) -print 2>/dev/null | sort)

configure_mirror() {
  local mirror=$1
  local source_file
  for source_file in "${APT_SOURCES[@]}"; do
    [ -f "$source_file" ] || continue
    sed -Ei \
      -e "s|https?://([[:alnum:].-]+\\.)?archive\\.ubuntu\\.com/ubuntu/?|http://$mirror/ubuntu|g" \
      -e "s|https?://security\\.ubuntu\\.com/ubuntu/?|http://$mirror/ubuntu|g" \
      "$source_file"
  done
}

repair_dpkg() {
  # A prior timeout may leave configured packages waiting on dependencies. This
  # first pass handles the common case; the post-index fix-broken pass converges
  # dependency failures without declaring a half-configured host ready.
  timeout --signal=TERM --kill-after=15s 45s dpkg --configure -a || true
}

apt_for_mirror() {
  local mirror=$1
  local operation=$2
  shift 2

  configure_mirror "$mirror"
  echo "apt: trying $operation with mirror $mirror"
  repair_dpkg
  rm -rf /var/lib/apt/lists/partial/*
  timeout --signal=TERM --kill-after=15s 60s apt-get -q update || return 1
  timeout --signal=TERM --kill-after=15s 120s \
    apt-get -q -y --no-install-recommends --fix-broken install || return 1
  timeout --signal=TERM --kill-after=15s 45s dpkg --configure -a || return 1
  if [ "$operation" = install ]; then
    # Keep mirror/network failure out of the dpkg mutation phase. A timed-out
    # download can safely fall back before installation begins.
    timeout --signal=TERM --kill-after=15s 180s \
      apt-get -q -y --no-install-recommends --download-only install "$@" || return 1
    timeout --signal=TERM --kill-after=30s 120s \
      apt-get -q -y --no-install-recommends --no-download install "$@" || return 1
  fi
  [ -z "$(dpkg --audit)" ] || return 1
}

operation=${1:-}
case "$operation" in
  update)
    shift
    ;;
  install)
    shift
    [ "$#" -gt 0 ] || { echo 'usage: ona-apt install <package>...' >&2; exit 2; }
    ;;
  *)
    echo 'usage: ona-apt <update|install> [package...]' >&2
    exit 2
    ;;
esac

exec 9>/run/lock/ona-apt.lock
flock -w 30 9

for mirror in "${APT_MIRRORS[@]}"; do
  if apt_for_mirror "$mirror" "$operation" "$@"; then
    echo "apt: $operation succeeded with mirror $mirror"
    exit 0
  fi
  echo "apt: bounded $operation attempt failed with mirror $mirror" >&2
done

echo "apt: all approved mirrors failed for $operation" >&2
exit 1

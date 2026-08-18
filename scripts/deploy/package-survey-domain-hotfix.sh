#!/usr/bin/env bash
# Builds a reviewable production-compatible API artifact without contacting AWS.
set -euo pipefail

PRODUCTION_BASE=093756cb1d4efbd5c5c968f6a4124a399f7f5d2c
EXPECTED_BRANCH=hotfix/prod-combined-domain-email
REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$REPO_ROOT"

APPROVED_SHA=${1:?usage: package-survey-domain-hotfix.sh <approved-40-character-sha> [output.tar.gz]}
OUTPUT=${2:-"survey-domain-hotfix-${APPROVED_SHA}.tar.gz"}
CURRENT_SHA=$(git rev-parse HEAD)
CURRENT_BRANCH=$(git branch --show-current)

[ "$CURRENT_BRANCH" = "$EXPECTED_BRANCH" ] || {
  echo "Refusing packaging from unexpected branch: $CURRENT_BRANCH" >&2
  exit 1
}
[ "$APPROVED_SHA" = "$CURRENT_SHA" ] && [ ${#APPROVED_SHA} -eq 40 ] || {
  echo "Approved SHA must exactly match the checked-out 40-character revision" >&2
  exit 1
}
[ -z "$(git status --porcelain)" ] || {
  echo "Refusing to package a dirty worktree" >&2
  exit 1
}
git merge-base --is-ancestor "$PRODUCTION_BASE" "$CURRENT_SHA"

git diff --exit-code "$PRODUCTION_BASE...$CURRENT_SHA" -- \
  db api/package.json api/package-lock.json \
  scripts/deploy/bootstrap-admin.js \
  scripts/deploy/finalize-legacy-accounts.js

unexpected_api_changes=$(git diff --name-only "$PRODUCTION_BASE...$CURRENT_SHA" -- api \
  | grep -Ev '^(api/server\.js|api/test/security\.test\.js|api/\.env\.local\.example)$' || true)
if [ -n "$unexpected_api_changes" ]; then
  echo "Refusing packaging with API changes outside the reviewed allowlist:" >&2
  printf '%s\n' "$unexpected_api_changes" >&2
  exit 1
fi

npm ci --workspace api
npm test --workspace api

stage_dir=$(mktemp -d)
trap 'rm -rf "$stage_dir"' EXIT
mkdir -p "$stage_dir/deploy" "$stage_dir/db"
rsync -a --exclude node_modules api "$stage_dir/"
cp -a db/changelogs "$stage_dir/db/"
cp scripts/deploy/remote-deploy.sh \
   scripts/deploy/bootstrap-admin.js \
   scripts/deploy/finalize-legacy-accounts.js \
   scripts/deploy/remote-deploy-survey-domain-hotfix.sh \
   "$stage_dir/deploy/"
printf '%s\n' "$CURRENT_SHA" > "$stage_dir/REVISION"
tar -czf "$OUTPUT" -C "$stage_dir" .
sha256sum "$OUTPUT" > "$OUTPUT.sha256"
printf 'Created %s\nChecksum: ' "$OUTPUT"
cat "$OUTPUT.sha256"

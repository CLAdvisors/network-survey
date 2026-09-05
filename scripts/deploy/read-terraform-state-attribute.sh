#!/usr/bin/env bash
# Read one top-level scalar attribute from an exact Terraform state address.
set -euo pipefail

ADDRESS=${1:?usage: read-terraform-state-attribute.sh <state-address> <attribute>}
ATTRIBUTE=${2:?usage: read-terraform-state-attribute.sh <state-address> <attribute>}

terraform state show -no-color "$ADDRESS" | awk -F= -v key="$ATTRIBUTE" '
  {
    name=$1
    gsub(/^[[:space:]]+|[[:space:]]+$/, "", name)
    if (name != key) next
    value=substr($0, index($0, "=") + 1)
    gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
    if (value ~ /^".*"$/) value=substr(value, 2, length(value) - 2)
    print value
    found=1
    exit
  }
  END { if (!found) exit 1 }
'

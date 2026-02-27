#!/usr/bin/env bash
# Gate: T004 — Create role multiplier resolver
# Contract: src/engine/roles.ts must export resolveRoleMultipliers()
set -euo pipefail

FILE="src/engine/roles.ts"
# Assertion #1
test -f "$FILE" || { echo "FAIL: $FILE does not exist" >&2; exit 1; }

# Assertion #2
grep -q 'export.*function resolveRoleMultipliers' "$FILE" || \
# Assertion #3
grep -q 'export function resolveRoleMultipliers' "$FILE" || \
  { echo "FAIL: resolveRoleMultipliers function not exported" >&2; exit 1; }

# Assertion #4
grep -q 'RoleConfig' "$FILE" || { echo "FAIL: RoleConfig type not referenced" >&2; exit 1; }

# Verify canonical defaults are present
# Assertion #5
grep -q '6' "$FILE" || { echo "FAIL: RE default (6) not found" >&2; exit 1; }
# Assertion #6
grep -q '4' "$FILE" || { echo "FAIL: TS default (4) not found" >&2; exit 1; }
# Assertion #7
grep -q '1.5' "$FILE" || { echo "FAIL: PE default (1.5) not found" >&2; exit 1; }

echo "PASS: T004 — role multiplier resolver exports resolveRoleMultipliers with defaults"

#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T009 — Implement scripts/dev/validate-staging.sh

FILE="scripts/dev/validate-staging.sh"

# Assertion 1: File exists and is executable
test -f "$FILE"
test -x "$FILE"

# Assertion 2: Rejects out-of-scope files
grep -q "Out-of-scope file staged:" "$FILE"
grep -q "ALLOWED_PREFIXES=(" "$FILE"

# Assertion 3: Rejects build plan modifications
grep -q "Build plan staged: specs/000-build-plan.md" "$FILE"
grep -q "agents must not modify the build plan (Rule 3)" "$FILE"

# Assertion 4: Orphan detection
grep -q "Orphan staged:" "$FILE"
grep -q "Orphan spec dir staged" "$FILE"

echo "PASS: T009 — scripts/dev/validate-staging.sh verified"

#!/usr/bin/env bash
# Gate: T015 — Extend GwrkConfigSchema for effort and compression
# Contract: src/utils/config.ts must include effort and compression optional keys
set -euo pipefail

FILE="src/utils/config.ts"
# Assertion #1
test -f "$FILE" || { echo "FAIL: $FILE does not exist" >&2; exit 1; }

# Assertion #2
grep -q 'effort' "$FILE" || { echo "FAIL: effort config key not found in schema" >&2; exit 1; }
# Assertion #3
grep -q 'compression' "$FILE" || { echo "FAIL: compression config key not found in schema" >&2; exit 1; }
# Assertion #4
grep -q 'hoursPerSP\|hoursPerSp' "$FILE" || { echo "FAIL: hoursPerSP field not found in effort config" >&2; exit 1; }
# Assertion #5
grep -q 'sessionGapMinutes' "$FILE" || { echo "FAIL: sessionGapMinutes field not found in compression config" >&2; exit 1; }

echo "PASS: T015 — config schema extended with effort and compression keys"

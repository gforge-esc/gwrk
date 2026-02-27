#!/usr/bin/env bash
# Gate: T013 — Create cross-feature summary generator
# Contract: src/engine/compression.ts must also export generateSummary()
set -euo pipefail

FILE="src/engine/compression.ts"
# Assertion #1
test -f "$FILE" || { echo "FAIL: $FILE does not exist" >&2; exit 1; }

# Assertion #2
grep -q 'export.*function generateSummary' "$FILE" || \
# Assertion #3
grep -q 'export function generateSummary' "$FILE" || \
  { echo "FAIL: generateSummary function not exported" >&2; exit 1; }

# Assertion #4
grep -q 'CompressionSummary' "$FILE" || { echo "FAIL: CompressionSummary return type not referenced" >&2; exit 1; }
# Assertion #5
grep -q 'trend' "$FILE" || { echo "FAIL: trend calculation not found" >&2; exit 1; }

echo "PASS: T013 — compression engine exports generateSummary with trend"

#!/usr/bin/env bash
# Gate: T012 — Create compression ratio calculator
# Contract: src/engine/compression.ts must export computeCompression()
set -euo pipefail

FILE="src/engine/compression.ts"
# Assertion #1
test -f "$FILE" || { echo "FAIL: $FILE does not exist" >&2; exit 1; }

# Assertion #2
grep -q 'export.*function computeCompression' "$FILE" || \
# Assertion #3
grep -q 'export function computeCompression' "$FILE" || \
  { echo "FAIL: computeCompression function not exported" >&2; exit 1; }

# Assertion #4
grep -q 'CompressionRatios' "$FILE" || { echo "FAIL: CompressionRatios return type not referenced" >&2; exit 1; }
# Assertion #5
grep -q 'EffortForecast' "$FILE" || { echo "FAIL: EffortForecast parameter type not referenced" >&2; exit 1; }
# Assertion #6
grep -q 'DeliveryActuals' "$FILE" || { echo "FAIL: DeliveryActuals parameter type not referenced" >&2; exit 1; }
# Assertion #7
grep -q 'pointCompression' "$FILE" || { echo "FAIL: pointCompression calculation not found" >&2; exit 1; }
# Assertion #8
grep -q 'totalCompression' "$FILE" || { echo "FAIL: totalCompression calculation not found" >&2; exit 1; }

echo "PASS: T012 — compression engine exports computeCompression with correct types"

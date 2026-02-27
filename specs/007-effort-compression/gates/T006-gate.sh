#!/usr/bin/env bash
# Gate: T006 — Create effort report markdown writer
# Contract: src/engine/report-writer.ts must export writeEffortReport()
set -euo pipefail

FILE="src/engine/report-writer.ts"
# Assertion #1
test -f "$FILE" || { echo "FAIL: $FILE does not exist" >&2; exit 1; }

# Assertion #2
grep -q 'export.*function writeEffortReport' "$FILE" || \
# Assertion #3
grep -q 'export function writeEffortReport' "$FILE" || \
  { echo "FAIL: writeEffortReport function not exported" >&2; exit 1; }

# Assertion #4
grep -q 'EffortReport' "$FILE" || { echo "FAIL: EffortReport type not referenced" >&2; exit 1; }
# Assertion #5
grep -q 'docs/assessments' "$FILE" || grep -q 'effort-' "$FILE" || { echo "FAIL: output path pattern not found" >&2; exit 1; }

echo "PASS: T006 — report writer exports writeEffortReport"

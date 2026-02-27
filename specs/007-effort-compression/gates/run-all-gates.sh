#!/usr/bin/env bash
# Run all Hard Gates for 007-effort-compression
# Exit on first failure — gates are sequential dependencies
set -euo pipefail

GATES_DIR="$(cd "$(dirname "$0")" && pwd)"
FEATURE_DIR="$(dirname "$GATES_DIR")"
PROJECT_ROOT="$(cd "$FEATURE_DIR/../.." && pwd)"

cd "$PROJECT_ROOT"

PASS=0
FAIL=0
TOTAL=0

for gate in "$GATES_DIR"/T*-gate.sh; do
  [ -f "$gate" ] || continue
  TOTAL=$((TOTAL + 1))
  tid=$(basename "$gate" | sed 's/-gate.sh//')
  
  if bash "$gate" > /dev/null 2>&1; then
    echo "✅ $tid — PASS"
    PASS=$((PASS + 1))
  else
    echo "❌ $tid — FAIL"
    FAIL=$((FAIL + 1))
  fi
done

echo ""
echo "════════════════════════════════════"
echo "  Results: $PASS/$TOTAL passed, $FAIL failed"
echo "════════════════════════════════════"

[ "$FAIL" -eq 0 ] || exit 1

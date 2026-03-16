#!/usr/bin/env bash
# run-all-gates.sh — Runs all T*-gate.sh scripts and reports pass/fail
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

TOTAL=0
PASSED=0
FAILED=0
FAILURES=()

for gate in "$SCRIPT_DIR"/T*-gate.sh; do
  [[ ! -f "$gate" ]] && continue
  name="$(basename "$gate")"
  ((TOTAL++))

  if bash "$gate" > /dev/null 2>&1; then
    echo "✓ $name"
    ((PASSED++))
  else
    echo "✗ $name"
    ((FAILED++))
    FAILURES+=("$name")
  fi
done

echo ""
echo "───────────────────────────────"
echo "Gates: $PASSED/$TOTAL passed, $FAILED failed"

if [[ $FAILED -gt 0 ]]; then
  echo ""
  echo "Failures:"
  for f in "${FAILURES[@]}"; do
    echo "  - $f"
  done
  exit 1
fi

exit 0

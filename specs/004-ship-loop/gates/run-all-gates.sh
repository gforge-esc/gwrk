#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
PASS=0; FAIL=0; TOTAL=0
for gate in specs/004-ship-loop/gates/T0*-gate.sh; do
  TOTAL=$((TOTAL + 1))
  task=$(basename "$gate" | sed 's/-gate.sh//')
  if bash "$gate" > /dev/null 2>&1; then
    echo "✅ $task"; PASS=$((PASS + 1))
  else
    echo "❌ $task"; FAIL=$((FAIL + 1))
  fi
done
echo ""; echo "Results: $PASS/$TOTAL pass, $FAIL fail"
[[ "$FAIL" -eq 0 ]] && exit 0 || exit 1

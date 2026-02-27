#!/usr/bin/env bash
# Run all gate scripts for 006-pulse
# Usage: ./run-all-gates.sh [phase]
#   No args: run all gates
#   phase 1: run T001–T008
#   phase 2: run T009–T014
#   phase 3: run T015–T018
set -euo pipefail

GATE_DIR="$(cd "$(dirname "$0")" && pwd)"
PHASE="${1:-all}"
PASS=0
FAIL=0
FAILED_GATES=()

run_gate() {
  local gate="$1"
  local path="$GATE_DIR/$gate"
  if [ ! -f "$path" ]; then
    echo "⚠️  SKIP: $gate (not found)"
    return
  fi
  if bash "$path" 2>&1; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    FAILED_GATES+=("$gate")
  fi
  echo ""
}

case "$PHASE" in
  1)
    echo "═══ Phase 1: Pulse Engine (T001–T008) ═══"
    for i in $(seq -w 1 8); do run_gate "T00${i}-gate.sh"; done
    ;;
  2)
    echo "═══ Phase 2: CLI Commands + Config (T009–T014) ═══"
    for i in $(seq -w 9 14); do
      if [ ${#i} -eq 1 ]; then i="00$i"; elif [ ${#i} -eq 2 ]; then i="0$i"; fi
      run_gate "T${i}-gate.sh"
    done
    ;;
  3)
    echo "═══ Phase 3: Multi-Repo Aggregation (T015–T018) ═══"
    for i in $(seq -w 15 18); do
      if [ ${#i} -eq 2 ]; then i="0$i"; fi
      run_gate "T${i}-gate.sh"
    done
    ;;
  all)
    echo "═══ Running ALL gates (T001–T018) ═══"
    for f in "$GATE_DIR"/T*-gate.sh; do
      run_gate "$(basename "$f")"
    done
    ;;
  *)
    echo "Usage: $0 [1|2|3|all]"
    exit 1
    ;;
esac

echo "═══════════════════════════════════"
echo "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  echo "Failed gates:"
  for g in "${FAILED_GATES[@]}"; do echo "  ❌ $g"; done
  exit 1
fi
echo "✅ All gates passed"

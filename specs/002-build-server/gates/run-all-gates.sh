#!/usr/bin/env bash
# Run all Hard Gates for 002-build-server
# Usage: ./run-all-gates.sh [phase_number]
#   No args = run all gates
#   With arg = run gates for that phase only
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PASS=0
FAIL=0
ERRORS=()

# Define phase → task ID ranges
declare -A PHASE_RANGES
PHASE_RANGES[1]="T001 T002 T003 T004 T005 T006 T007"
PHASE_RANGES[2]="T008 T009 T010 T011 T012 T013"
PHASE_RANGES[3]="T014 T015 T016 T017"
PHASE_RANGES[4]="T018 T019 T020 T021"
PHASE_RANGES[5]="T022 T023 T024 T025 T026 T027 T028"

# Determine which gates to run
if [ "${1:-}" != "" ]; then
  PHASE="$1"
  if [ -z "${PHASE_RANGES[$PHASE]+x}" ]; then
    echo "ERROR: Unknown phase $PHASE. Valid: 1-5"
    exit 1
  fi
  TASKS="${PHASE_RANGES[$PHASE]}"
  echo "═══════════════════════════════════════════════"
  echo " GATES · 002-build-server · Phase $PHASE"
  echo "═══════════════════════════════════════════════"
else
  TASKS=""
  for p in 1 2 3 4 5; do
    TASKS="$TASKS ${PHASE_RANGES[$p]}"
  done
  echo "═══════════════════════════════════════════════"
  echo " GATES · 002-build-server · All Phases"
  echo "═══════════════════════════════════════════════"
fi

for tid in $TASKS; do
  gate="$SCRIPT_DIR/${tid}-gate.sh"
  if [ ! -f "$gate" ]; then
    echo "  ⚠️  $tid: gate script not found"
    FAIL=$((FAIL + 1))
    ERRORS+=("$tid: gate script missing")
    continue
  fi

  if bash "$gate" > /dev/null 2>&1; then
    echo "  ✅ $tid: PASS"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $tid: FAIL"
    FAIL=$((FAIL + 1))
    ERRORS+=("$tid")
  fi
done

echo ""
echo "═══════════════════════════════════════════════"
echo " Results: $PASS passed, $FAIL failed"
echo "═══════════════════════════════════════════════"

if [ ${#ERRORS[@]} -gt 0 ]; then
  echo ""
  echo "Failed gates:"
  for e in "${ERRORS[@]}"; do
    echo "  - $e"
  done
  exit 1
fi

exit 0

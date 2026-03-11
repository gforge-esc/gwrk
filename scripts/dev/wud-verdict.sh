#!/usr/bin/env bash
# wud-verdict.sh — Deterministic GO/NO-GO verdict via gate execution
#
# ARCHITECTURE: tasks.json.gateScript is the foreign key.
# This script iterates tasks in the phase, runs each task's gate,
# and writes the result directly back to tasks.json.
#
# NO LLM REQUIRED. The mapping is structural.
#
# Usage: ./scripts/dev/wud-verdict.sh <spec_dir> <phase_number>
#
# Exit codes:
#   0 - GO (all tasks in phase pass their gates)
#   1 - NO-GO (one or more gates failed)
#   2 - Error (missing tasks.json, jq unavailable, etc.)

set -euo pipefail

SPEC_DIR="${1:-}"
PHASE_NUM="${2:-}"

if [[ -z "$SPEC_DIR" ]] || [[ -z "$PHASE_NUM" ]]; then
  echo "Usage: $0 <spec_dir> <phase_number>" >&2
  exit 2
fi

TASKS_FILE="$SPEC_DIR/.gwrk/tasks.json"
if [[ ! -f "$TASKS_FILE" ]]; then
  echo "[wud-verdict] ERROR: .gwrk/tasks.json not found in $SPEC_DIR" >&2
  exit 2
fi

if ! command -v jq &>/dev/null; then
  echo "[wud-verdict] ERROR: jq command not found" >&2
  exit 2
fi

# Build the phase ID pattern (phase-01, phase-02, etc.)
PHASE_ID=$(printf "phase-%02d" "$PHASE_NUM")

# Check phase exists in tasks.json
PHASE_EXISTS=$(jq -r --arg pid "$PHASE_ID" '[.phases[] | select(.id == $pid)] | length' "$TASKS_FILE")
if [[ "$PHASE_EXISTS" -eq 0 ]]; then
  echo "[wud-verdict] ERROR: Phase $PHASE_ID not found in tasks.json" >&2
  exit 2
fi

# ──────────────────────────────────────────────────
# Per-task gate execution → tasks.json reconciliation
# The gateScript field IS the foreign key. No LLM needed.
# ──────────────────────────────────────────────────

TOTAL=0
PASSED=0
FAILED=0
FAILED_TASKS=""

echo "[wud-verdict] Running per-task gates for ${PHASE_ID}..."
echo "────────────────────────────────────────"

# Extract task IDs and their gate scripts for this phase
TASK_DATA=$(jq -r --arg pid "$PHASE_ID" \
  '.phases[] | select(.id == $pid) | .tasks[] | "\(.id)|\(.gateScript // "")"' \
  "$TASKS_FILE")

while IFS='|' read -r TASK_ID GATE_SCRIPT; do
  [[ -z "$TASK_ID" ]] && continue
  TOTAL=$((TOTAL + 1))

  # Resolve gate script path relative to spec dir
  if [[ -n "$GATE_SCRIPT" ]] && [[ -f "$SPEC_DIR/$GATE_SCRIPT" ]]; then
    # Run the gate
    if bash "$SPEC_DIR/$GATE_SCRIPT" > /dev/null 2>&1; then
      echo "  ✅ ${TASK_ID}: PASS"
      PASSED=$((PASSED + 1))
      # Write status = completed back to tasks.json
      jq --arg pid "$PHASE_ID" --arg tid "$TASK_ID" \
        '(.phases[] | select(.id == $pid) | .tasks[] | select(.id == $tid)).status = "completed"' \
        "$TASKS_FILE" > "$TASKS_FILE.tmp" && mv "$TASKS_FILE.tmp" "$TASKS_FILE"
    else
      echo "  ❌ ${TASK_ID}: FAIL"
      FAILED=$((FAILED + 1))
      FAILED_TASKS="${FAILED_TASKS}  ⦿ ${TASK_ID}\n"
      # Write status = open back to tasks.json
      jq --arg pid "$PHASE_ID" --arg tid "$TASK_ID" \
        '(.phases[] | select(.id == $pid) | .tasks[] | select(.id == $tid)).status = "open"' \
        "$TASKS_FILE" > "$TASKS_FILE.tmp" && mv "$TASKS_FILE.tmp" "$TASKS_FILE"
    fi
  else
    # No gate script — cannot verify, leave status unchanged
    echo "  ⚠️  ${TASK_ID}: NO GATE (${GATE_SCRIPT:-none})"
    # Count as pass if already completed, fail if open
    CURRENT_STATUS=$(jq -r --arg pid "$PHASE_ID" --arg tid "$TASK_ID" \
      '.phases[] | select(.id == $pid) | .tasks[] | select(.id == $tid) | .status' \
      "$TASKS_FILE")
    if [[ "$CURRENT_STATUS" == "completed" ]]; then
      PASSED=$((PASSED + 1))
    else
      FAILED=$((FAILED + 1))
      FAILED_TASKS="${FAILED_TASKS}  ⦿ ${TASK_ID} (no gate)\n"
    fi
  fi
done <<< "$TASK_DATA"

echo "────────────────────────────────────────"

# Verdict
if [[ "$FAILED" -eq 0 ]]; then
  echo "[wud-verdict] GO — ${PASSED}/${TOTAL} tasks pass (${PHASE_ID})"
  exit 0
else
  echo "[wud-verdict] NO-GO — ${FAILED}/${TOTAL} tasks failed (${PHASE_ID})"
  echo -e "$FAILED_TASKS"
  exit 1
fi

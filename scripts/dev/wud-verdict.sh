#!/usr/bin/env bash
# wud-verdict.sh — Deterministic GO/NO-GO verdict via tasks.json
#
# Flat-file tasks.json (ADR-001) is the SOLE source of truth for task completion.
# Replaces beads (bd) with jq on specs/<feature>/.gwrk/tasks.json.
#
# Usage: ./scripts/dev/wud-verdict.sh <spec_dir> <phase_number>
#
# Exit codes:
#   0 - GO (all tasks in phase are completed)
#   1 - NO-GO (open/in_progress tasks remain)
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
# PRIMARY VERDICT: Run gates if they exist
# Gates are truth, tasks.json status is bookkeeping.
# ──────────────────────────────────────────────────
GATES_SCRIPT="$SPEC_DIR/gates/run-all-gates.sh"
if [[ -f "$GATES_SCRIPT" ]]; then
  echo "[wud-verdict] Running gates for ${PHASE_ID}..."
  GATE_OUTPUT=$(bash "$GATES_SCRIPT" 2>&1) || true
  GATE_EXIT=${PIPESTATUS[0]:-$?}

  if [[ "$GATE_EXIT" -eq 0 ]]; then
    echo "[wud-verdict] GO — All gates pass (${PHASE_ID})"
    # Auto-complete tasks in tasks.json — gates are truth
    jq --arg pid "$PHASE_ID" \
      '(.phases[] | select(.id == $pid) | .tasks[].status) = "completed"' \
      "$TASKS_FILE" > "$TASKS_FILE.tmp" && mv "$TASKS_FILE.tmp" "$TASKS_FILE"
    echo "[wud-verdict] Auto-completed tasks in tasks.json"
    exit 0
  else
    echo "[wud-verdict] NO-GO — Gate failures (${PHASE_ID})"
    echo "$GATE_OUTPUT" | grep -iE "FAIL|ERROR" || true
    exit 1
  fi
fi

# ──────────────────────────────────────────────────
# FALLBACK: tasks.json only (when no gates exist)
# ──────────────────────────────────────────────────
echo "[wud-verdict] No gates found, falling back to tasks.json status..."

# Count open/in_progress vs total tasks for this phase
OPEN_COUNT=$(jq --arg pid "$PHASE_ID" \
  '[.phases[] | select(.id == $pid) | .tasks[] | select(.status == "open" or .status == "in_progress")] | length' \
  "$TASKS_FILE")

TOTAL_COUNT=$(jq --arg pid "$PHASE_ID" \
  '[.phases[] | select(.id == $pid) | .tasks[]] | length' \
  "$TASKS_FILE")

DONE_COUNT=$(( TOTAL_COUNT - OPEN_COUNT ))

if [[ "$OPEN_COUNT" -eq 0 ]]; then
  echo "[wud-verdict] GO — ${DONE_COUNT}/${TOTAL_COUNT} tasks complete (${PHASE_ID})"
  exit 0
else
  echo "[wud-verdict] NO-GO — ${OPEN_COUNT}/${TOTAL_COUNT} tasks still open (${PHASE_ID})"
  # Print the open task titles for context
  jq -r --arg pid "$PHASE_ID" \
    '.phases[] | select(.id == $pid) | .tasks[] | select(.status == "open" or .status == "in_progress") | "  ⦿ \(.id): \(.title)"' \
    "$TASKS_FILE"
  exit 1
fi

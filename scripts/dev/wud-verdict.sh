#!/usr/bin/env bash
# wud-verdict.sh — Deterministic GO/NO-GO verdict via beads
#
# Beads (`bd`) is the SOLE source of truth for task completion.
# Markdown task lists are static design; beads is the dynamic execution state.
#
# Usage: ./scripts/dev/wud-verdict.sh <spec_dir> <phase_number>
#
# Exit codes:
#   0 - GO (all tasks done/closed)
#   1 - NO-GO (open/in_progress tasks remain)
#   2 - Error (missing .beads-id, bd unavailable, etc.)

set -euo pipefail

SPEC_DIR="${1:-}"
PHASE_NUM="${2:-}"

if [[ -z "$SPEC_DIR" ]] || [[ -z "$PHASE_NUM" ]]; then
  echo "Usage: $0 <spec_dir> <phase_number>" >&2
  exit 2
fi

BEADS_ID_FILE="$SPEC_DIR/.beads-id"
if [[ ! -f "$BEADS_ID_FILE" ]]; then
  echo "[wud-verdict] ERROR: .beads-id not found in $SPEC_DIR" >&2
  exit 2
fi

if ! command -v bd &>/dev/null; then
  echo "[wud-verdict] ERROR: bd command not found" >&2
  exit 2
fi

if ! command -v jq &>/dev/null; then
  echo "[wud-verdict] ERROR: jq command not found" >&2
  exit 2
fi

# Resolve phase ID from .beads-id mapping
PHASE_ID=$(jq -r --arg n "$PHASE_NUM" '.phases[$n] // empty' "$BEADS_ID_FILE")

if [[ -z "$PHASE_ID" ]]; then
  echo "[wud-verdict] ERROR: Phase $PHASE_NUM not mapped in .beads-id" >&2
  exit 2
fi

# Query beads for open/in_progress children of this phase
CHILDREN_JSON=$(bd children "$PHASE_ID" --json 2>/dev/null || echo "[]")

OPEN_COUNT=$(echo "$CHILDREN_JSON" | jq '[.[] | select(.status == "open" or .status == "in_progress")] | length')
TOTAL_COUNT=$(echo "$CHILDREN_JSON" | jq 'length')
DONE_COUNT=$(( TOTAL_COUNT - OPEN_COUNT ))

if [[ "$OPEN_COUNT" -eq 0 ]]; then
  echo "[wud-verdict] GO — ${DONE_COUNT}/${TOTAL_COUNT} tasks complete (phase $PHASE_ID)"
  exit 0
else
  echo "[wud-verdict] NO-GO — ${OPEN_COUNT}/${TOTAL_COUNT} tasks still open (phase $PHASE_ID)"
  # Print the open task titles for context
  echo "$CHILDREN_JSON" | jq -r '.[] | select(.status == "open" or .status == "in_progress") | "  ⦿ \(.id): \(.title)"'
  exit 1
fi

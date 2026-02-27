#!/usr/bin/env bash
# scripts/dev/review-reopen.sh — Reopen a beads task with structured remediation notes.
#
# Usage:
#   ./scripts/dev/review-reopen.sh <PHASE_ID> <TASK_TITLE_GREP> <REVIEW_TYPE> <NOTE>
#
# Examples:
#   ./scripts/dev/review-reopen.sh gforge-ai-w2o.4 T031 uat \
#     "TC-009 TopNav — Expected: glyphs render. Actual: tofu □. Fix: replace PUA with Unicode."
#
# To reopen the PHASE itself after reopening tasks:
#   ./scripts/dev/review-reopen.sh --phase gforge-ai-w2o.4 <PASS>/<TOTAL> <FAIL_COUNT>
#
set -euo pipefail

usage() {
  cat <<EOF
Usage:
  $(basename "$0") <PHASE_ID> <TASK_GREP> <REVIEW_TYPE> <NOTE>
  $(basename "$0") --phase <PHASE_ID> <PASS_COUNT>/<TOTAL> <FAIL_COUNT>

Arguments (task mode):
  PHASE_ID      Beads phase ID (e.g., codered-w2o.4)
  TASK_GREP     grep pattern to match task title (e.g., T031, T035)
  REVIEW_TYPE   "code" or "uat"
  NOTE          Structured note WITHOUT the "REVIEW FAIL (type):" prefix — it's added automatically.

Arguments (phase mode):
  --phase       Flag to indicate phase-level reopen
  PHASE_ID      Beads phase ID
  PASS/TOTAL    e.g., 9/12
  FAIL_COUNT    Number of failed/re-opened tasks
EOF
  exit 1
}

# --- Phase mode ---
if [[ "${1:-}" == "--phase" ]]; then
  [[ $# -lt 4 ]] && usage
  PHASE_ID="$2"
  SCORE="$3"
  FAIL_COUNT="$4"
  FEATURE_DIR=$(grep -rl "$PHASE_ID" specs/*/. 2>/dev/null | head -1 | xargs dirname 2>/dev/null || echo "specs/unknown")

  echo "⟳ Reopening phase: $PHASE_ID"
  bd update "$PHASE_ID" --status in_progress
  bd update "$PHASE_ID" --notes "REVIEW: NO-GO. ${SCORE} pass, ${FAIL_COUNT} re-opened. Next: /implement ${FEATURE_DIR} (phase from beads)"
  echo "✓ Phase $PHASE_ID → in_progress"
  exit 0
fi

# --- Task mode ---
[[ $# -lt 4 ]] && usage

PHASE_ID="$1"
TASK_GREP="$2"
REVIEW_TYPE="$3"
NOTE="$4"

# Validate review type
if [[ "$REVIEW_TYPE" != "code" && "$REVIEW_TYPE" != "uat" ]]; then
  echo "ERROR: REVIEW_TYPE must be 'code' or 'uat', got: $REVIEW_TYPE" >&2
  exit 1
fi

# Step 1: Resolve task ID from phase children
echo "⟳ Resolving task matching '$TASK_GREP' in $PHASE_ID..."
MATCH=$(bd list --pretty --limit 0 2>/dev/null | grep "$PHASE_ID" | grep -i "$TASK_GREP" || true)

if [[ -z "$MATCH" ]]; then
  echo "ERROR: No task matching '$TASK_GREP' found in phase $PHASE_ID" >&2
  echo "Available tasks:" >&2
  bd list --pretty --limit 0 2>/dev/null | grep "$PHASE_ID" >&2
  exit 1
fi

# Extract the beads ID (first field that looks like codered-xxx.y.z)
TASK_ID=$(echo "$MATCH" | grep -oE '[a-z0-9-]+\.[0-9]+\.[0-9]+' | head -1)

if [[ -z "$TASK_ID" ]]; then
  echo "ERROR: Could not extract task ID from match: $MATCH" >&2
  exit 1
fi

TASK_TITLE=$(echo "$MATCH" | sed 's/.*] - //' | xargs)

echo "  Found: $TASK_ID — $TASK_TITLE"

# Step 2: Reopen
echo "⟳ Reopening $TASK_ID..."
bd update "$TASK_ID" --status open

# Step 3: Attach structured note
FULL_NOTE="REVIEW FAIL ($REVIEW_TYPE): $NOTE"
echo "⟳ Attaching note..."
bd update "$TASK_ID" --notes "$FULL_NOTE"

echo "✓ $TASK_ID → open (note attached)"

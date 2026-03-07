#!/bin/bash
set -euo pipefail

# agent-run.sh — Governed Gemini CLI invocation with structured logging
# STRICT DOCKER ENVIRONMENT ONLY.
#
# Usage:
#   ./scripts/dev/agent-run.sh <workflow> <feature> [phase]
#
# Examples:
#   ./scripts/dev/agent-run.sh implement 006-fieldnotes-explorer 4
#   ./scripts/dev/agent-run.sh review-code 006-fieldnotes-explorer 3
#   ./scripts/dev/agent-run.sh plan 006-fieldnotes-explorer
#
# Environment:
#   APPROVAL_MODE  Override approval mode (default: per-workflow)
#   DRY_RUN        If "true", print the command without executing

# ──────────────────────────────────────────────────────────────────
# Config
# ──────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
RUNS_DIR="${RUNS_DIR:-$REPO_ROOT/.runs}"

# ANSI
BOLD=$'\033[1m'
DIM=$'\033[2m'
CYAN=$'\033[36m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
RED=$'\033[31m'
RESET=$'\033[0m'

# Terminal width for truncation (default 100 if not a tty)
TERM_WIDTH="${COLUMNS:-$(tput cols 2>/dev/null || echo 100)}"

# ──────────────────────────────────────────────────────────────────
# Usage
# ──────────────────────────────────────────────────────────────────
usage() {
  cat <<EOF
${BOLD}agent-run.sh${RESET} — Governed Gemini CLI invocation (CodeRed)

${BOLD}Usage:${RESET}
  $0 <workflow> <feature> [phase]

${BOLD}Workflows:${RESET}
  implement        Execute phase tasks (yolo mode)
  review-code      Technical code review (yolo mode — needs shell)
  review-uat       User acceptance testing (yolo mode — needs shell)
  plan             Generate implementation plan (yolo mode)
  plan-to-tasks    Generate structure JSON tasks and hard gates (yolo mode)
  specify          Create feature specification (yolo mode)
  analyze          Read-only consistency audit (plan mode)
  checklist        Generate quality gate checklists (yolo mode)
  define-tests     Generate red test files from spec/plan/contracts (yolo mode)
  work-until-done  Full lifecycle: implement → review → PR → CI (autonomous)
  define-until-solid  Full definitional lifecycle (autonomous)

${BOLD}Arguments:${RESET}
  feature   Feature identifier, e.g. 006-fieldnotes-explorer
  phase     Phase number (required for implement, review-code, review-uat)

${BOLD}Environment:${RESET}
  APPROVAL_MODE   Override the default approval mode
  DRY_RUN=true    Print command without executing

${BOLD}Logs:${RESET}
  Full output is logged to .runs/<timestamp>_<workflow>_<feature>.log
EOF
  exit "${1:-0}"
}

# ──────────────────────────────────────────────────────────────────
# Parse arguments
# ──────────────────────────────────────────────────────────────────
WORKFLOW="${1:-}"
FEATURE="${2:-}"
PHASE="${3:-}"
TASK_ID="${4:-}"

if [[ -z "$WORKFLOW" ]] || [[ -z "$FEATURE" ]]; then
  usage 1
fi

# Resolve spec path
SPEC_DIR="specs/${FEATURE}"
if [[ ! -d "$REPO_ROOT/$SPEC_DIR" ]]; then
  echo -e "${RED}✗${RESET} Spec directory not found: ${SPEC_DIR}"
  echo "  Available specs:"
  ls -1 "$REPO_ROOT/specs/" 2>/dev/null | sed 's/^/    /'
  exit 1
fi

# ──────────────────────────────────────────────────────────────────
# Map workflow → command + approval mode
# ──────────────────────────────────────────────────────────────────
case "$WORKFLOW" in
  implement)
    [[ -z "$PHASE" ]] && { echo -e "${RED}✗${RESET} Phase required for implement"; usage 1; }
    if [[ -n "$TASK_ID" ]]; then
      COMMAND="/implement ${SPEC_DIR} ${PHASE} ${TASK_ID}"
      LABEL="Implementing Task ${TASK_ID} (Phase ${PHASE})"
    else
      COMMAND="/implement ${SPEC_DIR} ${PHASE}"
      LABEL="Implementing Phase ${PHASE}"
    fi
    DEFAULT_MODE="yolo"
    ;;
  review-code)
    [[ -z "$PHASE" ]] && { echo -e "${RED}✗${RESET} Phase required for review-code"; usage 1; }
    COMMAND="/review-code ${SPEC_DIR} ${PHASE}"
    DEFAULT_MODE="yolo"  # needs shell
    LABEL="Code Review Phase ${PHASE}"
    ;;
  review-uat)
    [[ -z "$PHASE" ]] && { echo -e "${RED}✗${RESET} Phase required for review-uat"; usage 1; }
    COMMAND="/review-uat ${SPEC_DIR} ${PHASE}"
    DEFAULT_MODE="yolo"  # needs shell
    LABEL="UAT Phase ${PHASE}"
    ;;
  plan)
    COMMAND="/plan ${SPEC_DIR}"
    DEFAULT_MODE="yolo"
    LABEL="Planning"
    ;;
  specify)
    COMMAND="/specify ${SPEC_DIR}"
    DEFAULT_MODE="yolo"
    LABEL="Specifying"
    ;;
  analyze)
    COMMAND="/analyze ${SPEC_DIR}"
    DEFAULT_MODE="plan"
    LABEL="Analyzing (read-only)"
    ;;
  plan-to-tasks)
    COMMAND="/plan-to-tasks ${SPEC_DIR}"
    DEFAULT_MODE="yolo"
    LABEL="Generating JSON tasks and Hard Gates"
    ;;
  checklist)
    DOMAIN="${PHASE:-infrastructure}"  # reuse phase arg for domain
    COMMAND="/checklist ${SPEC_DIR} ${DOMAIN}"
    DEFAULT_MODE="yolo"
    LABEL="Generating ${DOMAIN} checklist"
    ;;
  define-tests)
    [[ -z "$PHASE" ]] && { echo -e "${RED}✗${RESET} Phase required for define-tests"; usage 1; }
    COMMAND="/define-tests ${SPEC_DIR} ${PHASE}"
    DEFAULT_MODE="yolo"
    LABEL="Defining red tests for Phase ${PHASE}"
    ;;
  gap-analysis)
    [[ -z "$PHASE" ]] && { echo -e "${RED}✗${RESET} Phase required for gap-analysis"; usage 1; }
    COMMAND="/gap-analysis ${SPEC_DIR} ${PHASE}"
    DEFAULT_MODE="yolo"
    LABEL="Gap Analysis for Phase ${PHASE}"
    ;;
  define-until-solid)
    # Delegate to the DUS orchestrator — it manages its own gemini calls
    exec "$SCRIPT_DIR/define-until-solid.sh" "$FEATURE" "${PHASE:-}"
    ;;
  work-until-done)
    [[ -z "$PHASE" ]] && { echo -e "${RED}✗${RESET} Phase required for work-until-done"; usage 1; }
    # Delegate entirely to the WUD orchestrator — it manages its own gemini calls
    exec "$SCRIPT_DIR/work-until-done.sh" "$FEATURE" "$PHASE" "${4:-}"
    ;;
  *)
    echo -e "${RED}✗${RESET} Unknown workflow: ${WORKFLOW}"
    usage 1
    ;;
esac

MODE="${APPROVAL_MODE:-$DEFAULT_MODE}"

# ──────────────────────────────────────────────────────────────────
# Set up log file
# ──────────────────────────────────────────────────────────────────
mkdir -p "$RUNS_DIR"
RUN_TS="$(date +%Y-%m-%d_%H%M%S)"
LOG_SUFFIX="${WORKFLOW}_${FEATURE}"
[[ -n "$PHASE" ]] && LOG_SUFFIX="${LOG_SUFFIX}_p${PHASE}"
LOG_FILE="$RUNS_DIR/${RUN_TS}_${LOG_SUFFIX}.log"

BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')"
COMMIT="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo 'unknown')"

# Write structured header to log
cat > "$LOG_FILE" << EOF
# CodeRed Agent Run Log
# ────────────────────────────────────────
# Timestamp : ${RUN_TS}
# Workflow  : ${WORKFLOW}
# Feature   : ${FEATURE}
# Phase     : ${PHASE:-n/a}
# Mode      : ${MODE}
# Branch    : ${BRANCH}
# Commit    : ${COMMIT}
# Command   : gemini -p "${COMMAND}" --approval-mode ${MODE}
# ────────────────────────────────────────

EOF

# ──────────────────────────────────────────────────────────────────
# Pre-flight
# ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}┌─────────────────────────────────────────────┐${RESET}"
echo -e "${CYAN}│${RESET}  ${BOLD}CodeRed Agent Runner${RESET}                       ${CYAN}│${RESET}"
echo -e "${CYAN}├─────────────────────────────────────────────┤${RESET}"
echo -e "${CYAN}│${RESET}  Workflow:  ${BOLD}${WORKFLOW}${RESET}"
echo -e "${CYAN}│${RESET}  Feature:   ${FEATURE}"
[[ -n "$PHASE" ]] && echo -e "${CYAN}│${RESET}  Phase:     ${PHASE}"
echo -e "${CYAN}│${RESET}  Mode:      ${MODE}"
echo -e "${CYAN}│${RESET}  Branch:    ${BRANCH} @ ${COMMIT}"
echo -e "${CYAN}│${RESET}  Log:       ${DIM}${LOG_FILE##*/}${RESET}"
echo -e "${CYAN}├─────────────────────────────────────────────┤${RESET}"

# Check for zombie processes (STRICT DOCKER ENFORCEMENT)
ZOMBIES=$( (pgrep -f "pnpm.*dev" || true; pgrep -f "cargo.*run" || true) | wc -l | tr -d ' ' )
if [[ "$ZOMBIES" -gt 0 ]]; then
  echo -e "${CYAN}│${RESET}  ${YELLOW}⚠ ${ZOMBIES} orphaned local dev process(es) found${RESET}"
  echo -e "${CYAN}│${RESET}  ${DIM}Killing... (I-007 Strict Docker Mandate)${RESET}"
  pkill -f "pnpm.*dev" 2>/dev/null || true
  pkill -f "cargo.*run" 2>/dev/null || true
  sleep 1
  echo -e "${CYAN}│${RESET}  ${GREEN}✓ Cleaned${RESET}"
else
  echo -e "${CYAN}│${RESET}  ${GREEN}✓ No orphaned processes${RESET}"
fi

# Verify .gwrk/tasks.json exists for execution workflows
if [[ "$WORKFLOW" == "implement" ]] || [[ "$WORKFLOW" == "review-code" ]] || [[ "$WORKFLOW" == "review-uat" ]]; then
  if [[ -f "$REPO_ROOT/$SPEC_DIR/.gwrk/tasks.json" ]]; then
    echo -e "${CYAN}│${RESET}  ${GREEN}✓ .gwrk/tasks.json found${RESET}"
  else
    echo -e "${CYAN}│${RESET}  ${YELLOW}⚠ No .gwrk/tasks.json — Run /plan-to-tasks first${RESET}"
  fi
fi

echo -e "${CYAN}└─────────────────────────────────────────────┘${RESET}"
echo ""

# ──────────────────────────────────────────────────────────────────
# Dry run check
# ──────────────────────────────────────────────────────────────────
if [[ "${DRY_RUN:-false}" == "true" ]]; then
  echo -e "${YELLOW}[DRY RUN]${RESET} Would execute:"
  echo "  gemini -p \"${COMMAND}\" --approval-mode ${MODE}"
  echo "  Log: ${LOG_FILE}"
  exit 0
fi

# ──────────────────────────────────────────────────────────────────
# Helper: strip ANSI codes for length calculation
# ──────────────────────────────────────────────────────────────────
strip_ansi() {
  sed 's/\x1B\[[0-9;]*[a-zA-Z]//g'
}

# ──────────────────────────────────────────────────────────────────
# Execute with tee to log + truncated terminal display
# ──────────────────────────────────────────────────────────────────
START_TIME=$(date +%s)
echo "# [START] $(date +%Y-%m-%dT%H:%M:%S%z)" >> "$LOG_FILE"

echo -e "${GREEN}▶${RESET} Starting Gemini agent...  ${DIM}(log: ${LOG_FILE##*/})${RESET}"
echo ""

cd "$REPO_ROOT"

# Run gemini, tee full output to log, truncate for terminal
gemini -p "${COMMAND}" --approval-mode "${MODE}" 2>&1 \
  | tee -a "$LOG_FILE" \
  | {
    SQUELCH=0        # 0 = normal, 1 = inside 429 error block
    BRACE_DEPTH=0    # track nested { } to find end of error object
    ATTEMPT_NUM=""

    while IFS= read -r line; do
      NOW=$(date +%H:%M:%S)
      ELAPSED=$(( $(date +%s) - START_TIME ))
      MINS=$(( ELAPSED / 60 ))
      SECS=$(( ELAPSED % 60 ))
      STAMP=$(printf "%s +%02d:%02d" "$NOW" "$MINS" "$SECS")

      # --- 429 Squelch State Machine ---
      if [[ "$SQUELCH" -eq 0 ]] && [[ "$line" =~ ^Attempt\ ([0-9]+)\ failed\ with\ status\ 429 ]]; then
        ATTEMPT_NUM="${BASH_REMATCH[1]}"
        SQUELCH=1
        BRACE_DEPTH=0
        printf "${DIM}%s${RESET}  ${YELLOW}⏳ 429 — Rate limited (attempt %s), retrying…${RESET}\n" "$STAMP" "$ATTEMPT_NUM"
        continue
      fi

      if [[ "$SQUELCH" -eq 1 ]]; then
        OPENS="${line//[^\{]/}"
        CLOSES="${line//[^\}]/}"
        BRACE_DEPTH=$(( BRACE_DEPTH + ${#OPENS} - ${#CLOSES} ))
        if [[ "$BRACE_DEPTH" -le 0 ]] && [[ ${#CLOSES} -gt 0 ]]; then
          SQUELCH=0
          BRACE_DEPTH=0
        fi
        continue
      fi

      # --- Normal display ---
      CLEAN=$(echo "$line" | strip_ansi)
      MAX_LEN=$(( TERM_WIDTH - 8 ))  
      if [[ ${#CLEAN} -gt $MAX_LEN ]]; then
        DISPLAY="${line:0:$MAX_LEN}${DIM}…${RESET}"
      else
        DISPLAY="$line"
      fi

      printf "${DIM}%s${RESET}  %s\n" "$STAMP" "$DISPLAY"
    done
  }

EXIT_CODE=${PIPESTATUS[0]}

# ──────────────────────────────────────────────────────────────────
# Cleanup & summary
# ──────────────────────────────────────────────────────────────────
END_TIME=$(date +%s)
TOTAL=$(( END_TIME - START_TIME ))
TOTAL_MINS=$(( TOTAL / 60 ))
TOTAL_SECS=$(( TOTAL % 60 ))
# Safely calculate log size, recreating directory if a test wiped it mid-flight
mkdir -p "$RUNS_DIR"
if [[ -f "$LOG_FILE" ]]; then
  LOG_SIZE=$(wc -c < "$LOG_FILE" | tr -d ' ')
  LOG_LINES=$(wc -l < "$LOG_FILE" | tr -d ' ')
else
  LOG_SIZE=0
  LOG_LINES=0
fi

# Append footer to log
cat >> "$LOG_FILE" << EOF || true

# [END] $(date +%Y-%m-%dT%H:%M:%S%z)
# Duration  : ${TOTAL_MINS}m ${TOTAL_SECS}s
# Exit Code : ${EXIT_CODE}
EOF

echo ""
if [[ "$EXIT_CODE" -eq 0 ]]; then
  echo -e "${CYAN}┌─────────────────────────────────────────────┐${RESET}"
  echo -e "${CYAN}│${RESET}  ${GREEN}✓ Agent complete${RESET}"
  echo -e "${CYAN}│${RESET}  Duration: ${BOLD}${TOTAL_MINS}m ${TOTAL_SECS}s${RESET}"
  echo -e "${CYAN}│${RESET}  Workflow: ${WORKFLOW} → ${FEATURE}"
  [[ -n "$PHASE" ]] && echo -e "${CYAN}│${RESET}  Phase:    ${PHASE}"
  echo -e "${CYAN}│${RESET}  Log:      ${DIM}${LOG_FILE##*/} (${LOG_LINES} lines, ${LOG_SIZE} bytes)${RESET}"
  echo -e "${CYAN}└─────────────────────────────────────────────┘${RESET}"
else
  echo -e "${CYAN}┌─────────────────────────────────────────────┐${RESET}"
  echo -e "${CYAN}│${RESET}  ${RED}✗ Agent failed (exit ${EXIT_CODE})${RESET}"
  echo -e "${CYAN}│${RESET}  Duration: ${BOLD}${TOTAL_MINS}m ${TOTAL_SECS}s${RESET}"
  echo -e "${CYAN}│${RESET}  Log:      ${DIM}${LOG_FILE##*/}${RESET}"
  echo -e "${CYAN}│${RESET}  Tail:     ${DIM}tail -20 ${LOG_FILE}${RESET}"
  echo -e "${CYAN}└─────────────────────────────────────────────┘${RESET}"
fi

# Post-run cleanup (Strict Docker Mandate)
pkill -f "pnpm.*dev" 2>/dev/null || true
pkill -f "cargo.*run" 2>/dev/null || true

exit "$EXIT_CODE"

#!/usr/bin/env bash
# work-until-done.sh — Autonomous phase orchestrator
#
# Executes the COMPLETE phase lifecycle in a single invocation:
#   IMPLEMENT → CODE_REVIEW → (re-implement if NO-GO) →
#   UAT_REVIEW → (re-implement if NO-GO) → PR + CI → DONE
#
# Shell is the control plane. LLM (gemini) is the compute plane.
# Beads (`bd`) is the sole source of truth for task state.
#
# Usage:
#   ./scripts/dev/work-until-done.sh <feature> <phase> [tracking_issue]
#
# Environment:
#   MAX_ITERATIONS   Max implement→review cycles (default: 3)
#   CI_TIMEOUT       CI wait timeout in minutes (default: 30)
#   DRY_RUN          If "true", print planned stages without executing
#   APPROVAL_MODE    gemini approval mode (default: yolo)
#
# State is persisted to .runs/<feature>_p<phase>.state for crash recovery.

set -euo pipefail

# ──────────────────────────────────────────────────────────────────
# Config
# ──────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
AGENT_RUNNER="$SCRIPT_DIR/agent-run.sh"
WUD_VERDICT="$SCRIPT_DIR/wud-verdict.sh"
WUD_BRANCH="$SCRIPT_DIR/wud-branch.sh"
WUD_CI_WAIT="$SCRIPT_DIR/wud-ci-wait.sh"

RUNS_DIR="$REPO_ROOT/.runs"

MAX_ITERATIONS="${MAX_ITERATIONS:-3}"
CI_TIMEOUT="${CI_TIMEOUT:-30}"
APPROVAL_MODE="${APPROVAL_MODE:-yolo}"

# ANSI
BOLD=$'\033[1m'
DIM=$'\033[2m'
CYAN=$'\033[36m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
RED=$'\033[31m'
MAGENTA=$'\033[35m'
RESET=$'\033[0m'

# ──────────────────────────────────────────────────────────────────
# Usage
# ──────────────────────────────────────────────────────────────────
usage() {
  cat <<EOF
${BOLD}work-until-done.sh${RESET} — Autonomous phase orchestrator (CodeRed)

${BOLD}Usage:${RESET}
  $0 <feature> <phase> [tracking_issue]

${BOLD}Arguments:${RESET}
  feature          Feature identifier, e.g. 001-pipeline-setup
  phase            Phase number, e.g. 1
  tracking_issue   GitHub issue number (optional, for PR body)

${BOLD}Environment:${RESET}
  MAX_ITERATIONS=${MAX_ITERATIONS}    Max implement→review cycles
  CI_TIMEOUT=${CI_TIMEOUT}         CI wait timeout in minutes
  DRY_RUN=true        Print stages without executing
  APPROVAL_MODE=yolo  Override gemini approval mode

${BOLD}State Machine:${RESET}
  IMPLEMENT → CODE_REVIEW → UAT_REVIEW → PR + CI → DONE
  Loops back to IMPLEMENT on any NO-GO verdict.
  Circuit breaker at ${MAX_ITERATIONS} iterations.
EOF
  exit "${1:-0}"
}

# ──────────────────────────────────────────────────────────────────
# Args
# ──────────────────────────────────────────────────────────────────
FEATURE="${1:-}"
PHASE="${2:-}"
TRACKING_ISSUE="${3:-}"

if [[ -z "$FEATURE" ]] || [[ -z "$PHASE" ]]; then
  usage 1
fi

SPEC_DIR="specs/${FEATURE}"
if [[ ! -d "$REPO_ROOT/$SPEC_DIR" ]]; then
  echo -e "${RED}✗${RESET} Spec directory not found: ${SPEC_DIR}" >&2
  exit 1
fi

# ──────────────────────────────────────────────────────────────────
# State Persistence
# ──────────────────────────────────────────────────────────────────
mkdir -p "$RUNS_DIR"
STATE_FILE="$RUNS_DIR/${FEATURE}_p${PHASE}.state"
WUD_LOG="$RUNS_DIR/$(date +%Y-%m-%d_%H%M%S)_wud_${FEATURE}_p${PHASE}.log"

save_state() {
  local stage="$1"
  local iteration="$2"
  local extra="${3:-}"
  cat > "$STATE_FILE" <<STATEJSON
{
  "stage": "${stage}",
  "iteration": ${iteration},
  "feature": "${FEATURE}",
  "phase": "${PHASE}",
  "tracking_issue": "${TRACKING_ISSUE}",
  "updated_at": "$(date +%Y-%m-%dT%H:%M:%S%z)"${extra}
}
STATEJSON
}

load_state() {
  if [[ -f "$STATE_FILE" ]]; then
    STAGE=$(jq -r '.stage' "$STATE_FILE")
    ITERATION=$(jq -r '.iteration' "$STATE_FILE")
    if [[ "$STAGE" == "FAILED" ]] || [[ "$STAGE" == "CIRCUIT_BREAK" ]] || [[ "$STAGE" == "DONE" ]]; then
      echo -e "${YELLOW}⟳ Previous state was ${STAGE}. Resetting to BRANCH_SETUP iteration 1.${RESET}"
      STAGE="BRANCH_SETUP"
      ITERATION=1
    else
      echo -e "${YELLOW}⟳ Resuming from state: ${STAGE}, iteration ${ITERATION}${RESET}"
    fi
  else
    STAGE="BRANCH_SETUP"
    ITERATION=1
  fi
}

# ──────────────────────────────────────────────────────────────────
# Logging
# ──────────────────────────────────────────────────────────────────
log() {
  local level="$1"; shift
  local ts
  ts="$(date +%H:%M:%S)"
  local color="$RESET"
  case "$level" in
    INFO)  color="$CYAN" ;;
    OK)    color="$GREEN" ;;
    WARN)  color="$YELLOW" ;;
    ERROR) color="$RED" ;;
    STAGE) color="$MAGENTA" ;;
  esac
  printf "${DIM}%s${RESET} ${color}[%s]${RESET} %s\n" "$ts" "$level" "$*" | tee -a "$WUD_LOG"
}

banner() {
  echo "" | tee -a "$WUD_LOG"
  echo -e "${MAGENTA}═══════════════════════════════════════════════${RESET}" | tee -a "$WUD_LOG"
  echo -e "${MAGENTA}  $1${RESET}" | tee -a "$WUD_LOG"
  echo -e "${MAGENTA}═══════════════════════════════════════════════${RESET}" | tee -a "$WUD_LOG"
  echo "" | tee -a "$WUD_LOG"
}

# ──────────────────────────────────────────────────────────────────
# Stage Executors
# ──────────────────────────────────────────────────────────────────
run_implement() {
  banner "IMPLEMENT — Iteration ${ITERATION}/${MAX_ITERATIONS}"
  log STAGE "Running agent-run.sh implement ${FEATURE} ${PHASE}"
  save_state "IMPLEMENTING" "$ITERATION"

  if ! APPROVAL_MODE="$APPROVAL_MODE" "$AGENT_RUNNER" implement "$FEATURE" "$PHASE"; then
    log ERROR "Implementation failed (exit $?)"
    return 1
  fi

  # Push after implementation
  log INFO "Pushing implementation commits..."
  "$WUD_BRANCH" "$FEATURE" push
  return 0
}

run_code_review() {
  banner "CODE REVIEW — Iteration ${ITERATION}/${MAX_ITERATIONS}"
  log STAGE "Running agent-run.sh review-code ${FEATURE} ${PHASE}"
  save_state "CODE_REVIEW" "$ITERATION"

  if ! APPROVAL_MODE="$APPROVAL_MODE" "$AGENT_RUNNER" review-code "$FEATURE" "$PHASE"; then
    log ERROR "Code review agent failed (exit $?)"
    return 1
  fi

  # Push review commits (task unchecks, review notes)
  log INFO "Pushing review commits..."
  "$WUD_BRANCH" "$FEATURE" push

  # Check verdict via beads
  log INFO "Checking beads verdict..."
  if "$WUD_VERDICT" "$REPO_ROOT/$SPEC_DIR" "$PHASE"; then
    log OK "Code review: GO"
    return 0
  else
    log WARN "Code review: NO-GO — open tasks remain"
    return 1
  fi
}

run_uat_review() {
  banner "UAT REVIEW — Iteration ${ITERATION}/${MAX_ITERATIONS}"
  log STAGE "Running agent-run.sh review-uat ${FEATURE} ${PHASE}"
  save_state "UAT_REVIEW" "$ITERATION"

  if ! APPROVAL_MODE="$APPROVAL_MODE" "$AGENT_RUNNER" review-uat "$FEATURE" "$PHASE"; then
    log ERROR "UAT review agent failed (exit $?)"
    return 1
  fi

  # Push review commits
  log INFO "Pushing UAT review commits..."
  "$WUD_BRANCH" "$FEATURE" push

  # Check verdict via beads
  log INFO "Checking beads verdict..."
  if "$WUD_VERDICT" "$REPO_ROOT/$SPEC_DIR" "$PHASE"; then
    log OK "UAT review: GO"
    return 0
  else
    log WARN "UAT review: NO-GO — open tasks remain"
    return 1
  fi
}

run_pr_and_ci() {
  banner "PR + CI GATE"
  save_state "PR_CI" "$ITERATION"

  # Ensure branch is pushed
  "$WUD_BRANCH" "$FEATURE" push

  # Create or update PR
  log INFO "Creating/updating PR..."
  local feature_branch
  feature_branch=$(git branch --show-current)
  local spec_name
  spec_name=$(basename "$SPEC_DIR")

  # Check for existing PR
  PR_NUMBER=$(gh pr list --head "$feature_branch" --base main --json number --jq '.[0].number' 2>/dev/null || echo "")

  if [[ -n "$PR_NUMBER" && "$PR_NUMBER" != "null" ]]; then
    log OK "PR #${PR_NUMBER} already exists"
  else
    # Create PR body using beads
    local phase_id
    phase_id=$(jq -r --arg n "$PHASE" '.phases[$n]' "$REPO_ROOT/$SPEC_DIR/.beads-id" 2>/dev/null || echo "")

    cat > /tmp/wud-pr-body.md <<PR_BODY
## feat(${spec_name#*-}): Phase ${PHASE}

### Tasks Completed
$(if [[ -n "$phase_id" ]]; then bd children "$phase_id" --json 2>/dev/null | jq -r '.[] | "- [\(if .status == "closed" then "x" else " " end)] \(.title)"' 2>/dev/null || echo "- See beads for task list"; else echo "- See beads for task list"; fi)

### Verification
- [x] All tasks verified via beads
- [x] Code review: GO
- [x] UAT: GO

---
_Generated by work-until-done.sh_
PR_BODY

    PR_NUMBER=$(gh pr create \
      --title "feat(${spec_name#*-}): Phase ${PHASE}" \
      --body-file /tmp/wud-pr-body.md \
      --base main 2>&1 | grep -oE '[0-9]+$' || echo "")

    if [[ -z "$PR_NUMBER" ]]; then
      log WARN "Could not extract PR number — skipping CI gate"
      return 0
    fi
    log OK "PR #${PR_NUMBER} created"
  fi

  save_state "CI_WAIT" "$ITERATION" ",\n  \"pr_number\": ${PR_NUMBER}"

  # Wait for CI
  log INFO "Waiting for CI checks on PR #${PR_NUMBER}..."
  if "$WUD_CI_WAIT" "$PR_NUMBER" "$CI_TIMEOUT"; then
    log OK "CI passed on PR #${PR_NUMBER}"
    return 0
  else
    log WARN "CI failed on PR #${PR_NUMBER}"
    return 1
  fi
}

# ──────────────────────────────────────────────────────────────────
# Pre-flight
# ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}┌─────────────────────────────────────────────────┐${RESET}"
echo -e "${CYAN}│${RESET}  ${BOLD}CodeRed Work-Until-Done${RESET}                        ${CYAN}│${RESET}"
echo -e "${CYAN}├─────────────────────────────────────────────────┤${RESET}"
echo -e "${CYAN}│${RESET}  Feature:       ${BOLD}${FEATURE}${RESET}"
echo -e "${CYAN}│${RESET}  Phase:         ${PHASE}"
echo -e "${CYAN}│${RESET}  Max Cycles:    ${MAX_ITERATIONS}"
echo -e "${CYAN}│${RESET}  CI Timeout:    ${CI_TIMEOUT}m"
echo -e "${CYAN}│${RESET}  Approval:      ${APPROVAL_MODE}"
[[ -n "$TRACKING_ISSUE" ]] && echo -e "${CYAN}│${RESET}  Issue:         #${TRACKING_ISSUE}"
echo -e "${CYAN}│${RESET}  Log:           ${DIM}${WUD_LOG##*/}${RESET}"
echo -e "${CYAN}└─────────────────────────────────────────────────┘${RESET}"
echo ""

# Write log header
cat > "$WUD_LOG" <<HEADER
# CodeRed Work-Until-Done Log
# ────────────────────────────────────────
# Feature   : ${FEATURE}
# Phase     : ${PHASE}
# Max Iter  : ${MAX_ITERATIONS}
# Started   : $(date +%Y-%m-%dT%H:%M:%S%z)
# ────────────────────────────────────────

HEADER

# ──────────────────────────────────────────────────────────────────
# Dry run
# ──────────────────────────────────────────────────────────────────
if [[ "${DRY_RUN:-false}" == "true" ]]; then
  echo -e "${YELLOW}[DRY RUN]${RESET} Planned stages:"
  echo "  1. Branch setup: feat/${FEATURE}"
  echo "  2. IMPLEMENT (via gemini)"
  echo "  3. CODE_REVIEW (via gemini) → beads verdict"
  echo "     ↳ NO-GO: loop to IMPLEMENT (max ${MAX_ITERATIONS}x)"
  echo "  4. UAT_REVIEW (via gemini) → beads verdict"
  echo "     ↳ NO-GO: loop to IMPLEMENT (max ${MAX_ITERATIONS}x)"
  echo "  5. PR + CI gate (gh pr checks --watch, ${CI_TIMEOUT}m timeout)"
  echo "     ↳ CI fail: loop to IMPLEMENT (max ${MAX_ITERATIONS}x)"
  echo "  6. DONE"
  exit 0
fi

# ──────────────────────────────────────────────────────────────────
# Main State Machine
# ──────────────────────────────────────────────────────────────────
START_TIME=$(date +%s)
load_state

cd "$REPO_ROOT"

# Stage: Branch Setup
if [[ "$STAGE" == "BRANCH_SETUP" ]]; then
  banner "BRANCH SETUP"
  log INFO "Ensuring feat/${FEATURE} branch..."
  "$WUD_BRANCH" "$FEATURE"
  STAGE="IMPLEMENTING"
fi

# Main loop
while [[ "$ITERATION" -le "$MAX_ITERATIONS" ]]; do

  # Stage: Implement
  if [[ "$STAGE" == "IMPLEMENTING" ]] || [[ "$STAGE" == "BRANCH_SETUP" ]]; then
    if ! run_implement; then
      log ERROR "Implementation failed on iteration ${ITERATION}. Aborting."
      save_state "FAILED" "$ITERATION"
      exit 1
    fi
    STAGE="CODE_REVIEW"
  fi

  # Stage: Code Review
  if [[ "$STAGE" == "CODE_REVIEW" ]]; then
    if run_code_review; then
      STAGE="UAT_REVIEW"
    else
      # NO-GO: loop back to implement
      log WARN "Code review NO-GO. Re-implementing (iteration $((ITERATION + 1)))..."
      ITERATION=$(( ITERATION + 1 ))
      if [[ "$ITERATION" -gt "$MAX_ITERATIONS" ]]; then
        log ERROR "Circuit breaker: max ${MAX_ITERATIONS} iterations reached after code review."
        save_state "CIRCUIT_BREAK" "$ITERATION"
        exit 1
      fi
      STAGE="IMPLEMENTING"
      continue
    fi
  fi

  # Stage: UAT Review
  if [[ "$STAGE" == "UAT_REVIEW" ]]; then
    if run_uat_review; then
      STAGE="PR_CI"
    else
      # NO-GO: loop back to implement
      log WARN "UAT NO-GO. Re-implementing (iteration $((ITERATION + 1)))..."
      ITERATION=$(( ITERATION + 1 ))
      if [[ "$ITERATION" -gt "$MAX_ITERATIONS" ]]; then
        log ERROR "Circuit breaker: max ${MAX_ITERATIONS} iterations reached after UAT."
        save_state "CIRCUIT_BREAK" "$ITERATION"
        exit 1
      fi
      STAGE="IMPLEMENTING"
      continue
    fi
  fi

  # Stage: PR + CI
  if [[ "$STAGE" == "PR_CI" ]] || [[ "$STAGE" == "CI_WAIT" ]]; then
    if run_pr_and_ci; then
      STAGE="DONE"
      break
    else
      # CI failed: loop back to implement
      log WARN "CI failed. Re-implementing (iteration $((ITERATION + 1)))..."
      ITERATION=$(( ITERATION + 1 ))
      if [[ "$ITERATION" -gt "$MAX_ITERATIONS" ]]; then
        log ERROR "Circuit breaker: max ${MAX_ITERATIONS} iterations reached after CI failure."
        save_state "CIRCUIT_BREAK" "$ITERATION"
        exit 1
      fi
      STAGE="IMPLEMENTING"
      continue
    fi
  fi

done

# ──────────────────────────────────────────────────────────────────
# Final Summary
# ──────────────────────────────────────────────────────────────────
END_TIME=$(date +%s)
TOTAL=$(( END_TIME - START_TIME ))
TOTAL_MINS=$(( TOTAL / 60 ))
TOTAL_SECS=$(( TOTAL % 60 ))

if [[ "$STAGE" == "DONE" ]]; then
  save_state "DONE" "$ITERATION"
  echo ""
  echo -e "${GREEN}╔═════════════════════════════════════════════════╗${RESET}"
  echo -e "${GREEN}║${RESET}  ${BOLD}✓ WORK UNTIL DONE — COMPLETE${RESET}                   ${GREEN}║${RESET}"
  echo -e "${GREEN}╠═════════════════════════════════════════════════╣${RESET}"
  echo -e "${GREEN}║${RESET}  Feature:    ${FEATURE}"
  echo -e "${GREEN}║${RESET}  Phase:      ${PHASE}"
  echo -e "${GREEN}║${RESET}  Iterations: ${ITERATION}/${MAX_ITERATIONS}"
  echo -e "${GREEN}║${RESET}  Duration:   ${BOLD}${TOTAL_MINS}m ${TOTAL_SECS}s${RESET}"
  echo -e "${GREEN}║${RESET}  Log:        ${DIM}${WUD_LOG##*/}${RESET}"
  echo -e "${GREEN}╚═════════════════════════════════════════════════╝${RESET}"
  log OK "DONE in ${TOTAL_MINS}m ${TOTAL_SECS}s after ${ITERATION} iteration(s)"

  # Clean up state file on success
  rm -f "$STATE_FILE"
  exit 0
else
  echo ""
  echo -e "${RED}╔═════════════════════════════════════════════════╗${RESET}"
  echo -e "${RED}║${RESET}  ${BOLD}✗ WORK UNTIL DONE — FAILED${RESET}                     ${RED}║${RESET}"
  echo -e "${RED}╠═════════════════════════════════════════════════╣${RESET}"
  echo -e "${RED}║${RESET}  Feature:    ${FEATURE}"
  echo -e "${RED}║${RESET}  Phase:      ${PHASE}"
  echo -e "${RED}║${RESET}  Stage:      ${STAGE}"
  echo -e "${RED}║${RESET}  Iteration:  ${ITERATION}/${MAX_ITERATIONS}"
  echo -e "${RED}║${RESET}  Duration:   ${BOLD}${TOTAL_MINS}m ${TOTAL_SECS}s${RESET}"
  echo -e "${RED}║${RESET}  State:      ${DIM}${STATE_FILE##*/}${RESET}"
  echo -e "${RED}║${RESET}  Log:        ${DIM}${WUD_LOG##*/}${RESET}"
  echo -e "${RED}╚═════════════════════════════════════════════════╝${RESET}"
  exit 1
fi

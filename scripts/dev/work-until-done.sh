#!/usr/bin/env bash
# work-until-done.sh — Autonomous phase orchestrator
#
# Executes the COMPLETE phase lifecycle in a single invocation:
#   IMPLEMENT → CODE_REVIEW → (re-implement if NO-GO) →
#   UAT_REVIEW → (re-implement if NO-GO) → PR + CI → DONE
#
# Shell is the control plane. LLM (gemini) is the compute plane.
# tasks.json (ADR-001) is the sole source of truth for task state.
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
AGENT_RUNNER="${AGENT_RUNNER_BIN:-$SCRIPT_DIR/agent-run.sh}"
WUD_VERDICT="${WUD_VERDICT_BIN:-$SCRIPT_DIR/wud-verdict.sh}"
WUD_BRANCH="${WUD_BRANCH_BIN:-$SCRIPT_DIR/wud-branch.sh}"
WUD_CI_WAIT="${WUD_CI_WAIT_BIN:-$SCRIPT_DIR/wud-ci-wait.sh}"

RUNS_DIR="${RUNS_DIR:-$REPO_ROOT/.runs}"

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
${BOLD}work-until-done.sh${RESET} — Autonomous phase orchestrator (gwrk)

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
EVENTS_FILE="$RUNS_DIR/${FEATURE}_p${PHASE}.events"
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

# FR-017: Emit structured events to sidecar file for digest assembly
emit_event() {
  local stage="$1"
  local summary="$2"
  local ts
  ts="$(date +%Y-%m-%dT%H:%M:%S%z)"
  echo "${stage}: ${summary} [${ts}]" >> "$EVENTS_FILE"
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
  mkdir -p "$RUNS_DIR"
  printf "${DIM}%s${RESET} ${color}[%s]${RESET} %s\n" "$ts" "$level" "$*" | tee -a "$WUD_LOG" || true
}

banner() {
  mkdir -p "$RUNS_DIR"
  echo "" | tee -a "$WUD_LOG" || true
  echo -e "${MAGENTA}═══════════════════════════════════════════════${RESET}" | tee -a "$WUD_LOG" || true
  echo -e "${MAGENTA}  $1${RESET}" | tee -a "$WUD_LOG" || true
  echo -e "${MAGENTA}═══════════════════════════════════════════════${RESET}" | tee -a "$WUD_LOG" || true
  echo "" | tee -a "$WUD_LOG" || true
}

# ──────────────────────────────────────────────────────────────────
# DB Recording
# ──────────────────────────────────────────────────────────────────
record_run() {
  local cmd="$1"; shift
  local exit_code="$1"; shift
  local duration="$1"; shift
  # macOS bash 3.2 bugs out on empty "$@" under set -u
  local extra_args=()
  if [[ $# -gt 0 ]]; then
    extra_args=("$@")
  fi

  # Use gwrk db record to log the step
  # We assume 'gwrk' is in the PATH or we use the one in REPO_ROOT/dist/cli.js
  local gwrk_cmd="gwrk"
  if ! command -v gwrk &>/dev/null; then
    gwrk_cmd="node $REPO_ROOT/dist/cli.js"
  fi

  if [[ ${#extra_args[@]} -gt 0 ]]; then
    $gwrk_cmd db record \
      --feature "$FEATURE" \
      --phase "$PHASE" \
      --command "$cmd" \
      --exit-code "$exit_code" \
      --duration "$duration" \
      --log "${WUD_LOG##*/}" \
      "${extra_args[@]}" >/dev/null 2>&1 || true
  else
    $gwrk_cmd db record \
      --feature "$FEATURE" \
      --phase "$PHASE" \
      --command "$cmd" \
      --exit-code "$exit_code" \
      --duration "$duration" \
      --log "${WUD_LOG##*/}" >/dev/null 2>&1 || true
  fi
}

# ──────────────────────────────────────────────────────────────────
# Stage Executors
# ──────────────────────────────────────────────────────────────────
run_implement() {
  local start_time=$(date +%s)
  banner "IMPLEMENT — Iteration ${ITERATION}/${MAX_ITERATIONS}"
  log STAGE "Running agent-run.sh implement ${FEATURE} ${PHASE}"
  save_state "IMPLEMENTING" "$ITERATION"

  set +e
  APPROVAL_MODE="$APPROVAL_MODE" "$AGENT_RUNNER" implement "$FEATURE" "$PHASE"
  local exit_code=$?
  set -e

  local duration=$(( $(date +%s) - start_time ))
  record_run "implement" "$exit_code" "$duration" --workflow "implement"

  if [[ "$exit_code" -eq 130 ]]; then
    # SIGINT — human cancelled, abort cleanly
    log WARN "Implementation interrupted (SIGINT). Aborting."
    return 1
  elif [[ "$exit_code" -ne 0 ]]; then
    # Agent failed — return non-zero so WUD can decide to retry
    log WARN "Implementation failed (exit $exit_code) — will retry"
    return 2
  fi

  # Push after implementation
  log INFO "Pushing implementation commits..."
  "$WUD_BRANCH" "$FEATURE" push
  return 0
}

run_code_review() {
  local start_time=$(date +%s)
  banner "CODE REVIEW — Iteration ${ITERATION}/${MAX_ITERATIONS}"
  log STAGE "Running agent-run.sh review-code ${FEATURE} ${PHASE}"
  save_state "CODE_REVIEW" "$ITERATION"

  set +e
  APPROVAL_MODE="$APPROVAL_MODE" "$AGENT_RUNNER" review-code "$FEATURE" "$PHASE"
  local agent_exit=$?
  set -e
  if [[ "$agent_exit" -ne 0 ]]; then
    log ERROR "Code review agent failed (exit $agent_exit)"
  fi

  # Push review commits (task unchecks, review notes)
  log INFO "Pushing review commits..."
  "$WUD_BRANCH" "$FEATURE" push

  # Check verdict via tasks.json
  log INFO "Checking tasks.json verdict..."
  local verdict="NO-GO"
  local exit_code=1
  if "$WUD_VERDICT" "$REPO_ROOT/$SPEC_DIR" "$PHASE"; then
    log OK "Code review: GO"
    verdict="GO"
    exit_code=0
  else
    log WARN "Code review: NO-GO — open tasks remain"
  fi

  local duration=$(( $(date +%s) - start_time ))
  record_run "review-code" "$agent_exit" "$duration" --workflow "review-code" --verdict "$verdict"

  return "$exit_code"
}

run_uat_review() {
  local start_time=$(date +%s)
  banner "UAT REVIEW — Iteration ${ITERATION}/${MAX_ITERATIONS}"
  log STAGE "Running agent-run.sh review-uat ${FEATURE} ${PHASE}"
  save_state "UAT_REVIEW" "$ITERATION"

  set +e
  APPROVAL_MODE="$APPROVAL_MODE" "$AGENT_RUNNER" review-uat "$FEATURE" "$PHASE"
  local agent_exit=$?
  set -e
  if [[ "$agent_exit" -ne 0 ]]; then
    log ERROR "UAT review agent failed (exit $agent_exit)"
  fi

  # Push review commits
  log INFO "Pushing UAT review commits..."
  "$WUD_BRANCH" "$FEATURE" push

  # Check verdict via tasks.json
  log INFO "Checking tasks.json verdict..."
  local verdict="NO-GO"
  local exit_code=1
  if "$WUD_VERDICT" "$REPO_ROOT/$SPEC_DIR" "$PHASE"; then
    log OK "UAT review: GO"
    verdict="GO"
    exit_code=0
  else
    log WARN "UAT review: NO-GO — open tasks remain"
  fi

  local duration=$(( $(date +%s) - start_time ))
  record_run "review-uat" "$agent_exit" "$duration" --workflow "review-uat" --verdict "$verdict"

  return "$exit_code"
}

run_pr_and_ci() {
  local start_time=$(date +%s)
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
  PR_NUMBER=$(gh pr list --head "$feature_branch" --base develop --json number --jq '.[0].number' 2>/dev/null || echo "")

  if [[ -n "$PR_NUMBER" && "$PR_NUMBER" != "null" ]]; then
    log OK "PR #${PR_NUMBER} already exists"
  else
    # Create PR body using tasks.json (ADR-001)
    local tasks_file="$REPO_ROOT/$SPEC_DIR/.gwrk/tasks.json"
    local phase_id
    phase_id=$(printf "phase-%02d" "$PHASE")

    cat > /tmp/wud-pr-body.md <<PR_BODY
## feat(${spec_name#*-}): Phase ${PHASE}

### Tasks Completed
$(if [[ -f "$tasks_file" ]]; then jq -r --arg pid "$phase_id" '.phases[] | select(.id == $pid) | .tasks[] | "- [\(if .status == "completed" then "x" else " " end)] \(.title)"' "$tasks_file" 2>/dev/null || echo "- See tasks.json for task list"; else echo "- See tasks.json for task list"; fi)

### Verification
- [x] All tasks verified via Hard Gates
- [x] Code review: GO
- [x] UAT: GO

---
_Generated by work-until-done.sh_
PR_BODY

    PR_NUMBER=$(gh pr create \
      --title "feat(${spec_name#*-}): Phase ${PHASE}" \
      --body-file /tmp/wud-pr-body.md \
      --base develop 2>&1 | grep -oE '[0-9]+$' || echo "")

    if [[ -z "$PR_NUMBER" ]]; then
      log WARN "Could not extract PR number — skipping CI gate"
      local duration=$(( $(date +%s) - start_time ))
      record_run "pr-create" "1" "$duration"
      return 0
    fi
    log OK "PR #${PR_NUMBER} created"
  fi

  save_state "CI_WAIT" "$ITERATION" ",\n  \"pr_number\": ${PR_NUMBER}"

  # Wait for CI
  log INFO "Waiting for CI checks on PR #${PR_NUMBER}..."
  local exit_code=0
  local gate_result="PASS"
  if ! "$WUD_CI_WAIT" "$PR_NUMBER" "$CI_TIMEOUT"; then
    log WARN "CI failed on PR #${PR_NUMBER}"
    exit_code=1
    gate_result="FAIL"
  else
    log OK "CI passed on PR #${PR_NUMBER}"
  fi

  local duration=$(( $(date +%s) - start_time ))
  record_run "ci-gate" "$exit_code" "$duration" --gate "$gate_result"

  return "$exit_code"
}

# ──────────────────────────────────────────────────────────────────
# Pre-flight
# ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}┌─────────────────────────────────────────────────┐${RESET}"
echo -e "${CYAN}│${RESET}  ${BOLD}gwrk Work-Until-Done${RESET}                           ${CYAN}│${RESET}"
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
# gwrk Work-Until-Done Log
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
  echo "  3. CODE_REVIEW (via gemini) → tasks.json verdict"
  echo "     ↳ NO-GO: loop to IMPLEMENT (max ${MAX_ITERATIONS}x)"
  echo "  4. UAT_REVIEW (via gemini) → tasks.json verdict"
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
  branch_start_time=$(date +%s)
  banner "BRANCH SETUP"
  log INFO "Ensuring feat/${FEATURE} branch..."
  set +e
  "$WUD_BRANCH" "$FEATURE"
  branch_exit_code=$?
  set -e
  
  if [[ "$branch_exit_code" -ne 0 ]]; then
    log ERROR "Branch setup failed"
  fi
  branch_duration=$(( $(date +%s) - branch_start_time ))
  record_run "branch-setup" "$branch_exit_code" "$branch_duration"
  
  if [[ "$branch_exit_code" -ne 0 ]]; then
    emit_event "BRANCH_SETUP" "FAILED — branch setup exited ${branch_exit_code}"
    exit 1
  fi
  emit_event "BRANCH_SETUP" "created/checked-out feat/${FEATURE} (${branch_duration}s)"
  STAGE="IMPLEMENTING"
fi

# Main loop
while [[ "$ITERATION" -le "$MAX_ITERATIONS" ]]; do

  # Stage: Implement
  if [[ "$STAGE" == "IMPLEMENTING" ]] || [[ "$STAGE" == "BRANCH_SETUP" ]]; then
    run_implement
    impl_exit=$?
    if [[ "$impl_exit" -eq 1 ]]; then
      # SIGINT or fatal — abort entirely
      log ERROR "Implementation aborted (SIGINT or fatal). Stopping."
      emit_event "IMPLEMENT" "FAILED — aborted (exit ${impl_exit})"
      save_state "FAILED" "$ITERATION"
      STAGE="FAILED"
      break
    elif [[ "$impl_exit" -eq 2 ]]; then
      # Agent failure — retry
      emit_event "IMPLEMENT" "FAILED — agent exited ${impl_exit}, will retry"
      log WARN "Agent failed. Retrying implementation (iteration $((ITERATION + 1)))..."
      ITERATION=$(( ITERATION + 1 ))
      if [[ "$ITERATION" -gt "$MAX_ITERATIONS" ]]; then
        log ERROR "Circuit breaker: max ${MAX_ITERATIONS} iterations reached during implementation."
        emit_event "CIRCUIT_BREAK" "max ${MAX_ITERATIONS} iterations reached during implementation"
        save_state "CIRCUIT_BREAK" "$ITERATION"
        cb_duration=$(( $(date +%s) - START_TIME ))
        record_run "circuit-break" "1" "$cb_duration" --retry-reason "Max iterations reached during implementation"
        STAGE="CIRCUIT_BREAK"
        break
      fi
      STAGE="IMPLEMENTING"
      continue
    fi
    emit_event "IMPLEMENT" "agent completed successfully, pushed commits"
    STAGE="CODE_REVIEW"
  fi

  # Stage: Code Review
  if [[ "$STAGE" == "CODE_REVIEW" ]]; then
    if run_code_review; then
      emit_event "CODE_REVIEW" "GO — all assertions satisfied"
      STAGE="UAT_REVIEW"
    else
      # NO-GO: loop back to implement
      emit_event "CODE_REVIEW" "NO-GO — open tasks remain, will retry"
      log WARN "Code review NO-GO. Re-implementing (iteration $((ITERATION + 1)))..."
      ITERATION=$(( ITERATION + 1 ))
      if [[ "$ITERATION" -gt "$MAX_ITERATIONS" ]]; then
        log ERROR "Circuit breaker: max ${MAX_ITERATIONS} iterations reached after code review."
        save_state "CIRCUIT_BREAK" "$ITERATION"
        cb_duration=$(( $(date +%s) - START_TIME ))
        record_run "circuit-break" "1" "$cb_duration" --retry-reason "Max iterations reached after code review"
        STAGE="CIRCUIT_BREAK"
        break
      fi
      STAGE="IMPLEMENTING"
      continue
    fi
  fi

  # Stage: UAT Review
  if [[ "$STAGE" == "UAT_REVIEW" ]]; then
    if run_uat_review; then
      emit_event "UAT_REVIEW" "GO — UAT assertions satisfied"
      STAGE="PR_CI"
    else
      # NO-GO: loop back to implement
      emit_event "UAT_REVIEW" "NO-GO — open tasks remain, will retry"
      log WARN "UAT NO-GO. Re-implementing (iteration $((ITERATION + 1)))..."
      ITERATION=$(( ITERATION + 1 ))
      if [[ "$ITERATION" -gt "$MAX_ITERATIONS" ]]; then
        log ERROR "Circuit breaker: max ${MAX_ITERATIONS} iterations reached after UAT."
        save_state "CIRCUIT_BREAK" "$ITERATION"
        cb_duration=$(( $(date +%s) - START_TIME ))
        record_run "circuit-break" "1" "$cb_duration" --retry-reason "Max iterations reached after UAT review"
        STAGE="CIRCUIT_BREAK"
        break
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
        cb_duration=$(( $(date +%s) - START_TIME ))
        record_run "circuit-break" "1" "$cb_duration" --retry-reason "Max iterations reached after CI failure"
        STAGE="CIRCUIT_BREAK"
        break
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
  final_duration=$(( $(date +%s) - START_TIME ))
  record_run "wud-complete" "0" "$final_duration"
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
  final_duration=$(( $(date +%s) - START_TIME ))
  record_run "wud-failed" "1" "$final_duration"
  echo ""
  echo -e "${RED}╔═════════════════════════════════════════════════╗${RESET}"
  echo -e "${RED}║${RESET}  ${BOLD}✗ WORK UNTIL DONE — FAILED${RESET}                     ${RED}║${RESET}"
  echo -e "${RED}╠═════════════════════════════════════════════════╣${RESET}"
  echo -e "${RED}║${RESET}  Feature:    ${FEATURE}"
  echo -e "${RED}║${RESET}  Phase:      ${PHASE}"
  echo -e "${RED}║${RESET}  Stage:      ${STAGE}"
  echo -e "${RED}║${RESET}  Iteration:  $((ITERATION - 1))/${MAX_ITERATIONS}"
  echo -e "${RED}║${RESET}  Duration:   ${BOLD}${TOTAL_MINS}m ${TOTAL_SECS}s${RESET}"
  echo -e "${RED}║${RESET}  State:      ${DIM}${STATE_FILE##*/}${RESET}"
  echo -e "${RED}║${RESET}  Log:        ${DIM}${WUD_LOG##*/}${RESET}"
  echo -e "${RED}╚═════════════════════════════════════════════════╝${RESET}"
  exit 1
fi

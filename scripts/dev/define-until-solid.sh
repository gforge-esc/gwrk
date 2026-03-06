#!/usr/bin/env bash
# define-until-solid.sh — Autonomous definitional orchestrator
#
# Runs the COMPLETE definitional lifecycle after spec + plan are approved:
#   PLAN_TO_TASKS → CHECKLIST → ANALYZE → (re-iterate if NOT READY) →
#   DEFINE_TESTS → DONE
#
# Shell is the control plane. LLM (gemini) is the compute plane.
# Quality gates from /analyze are the pass/fail oracle.
#
# Usage:
#   ./scripts/dev/define-until-solid.sh <feature> [phase]
#
# Environment:
#   MAX_ITERATIONS   Max define→analyze cycles (default: 3)
#   DRY_RUN          If "true", print planned stages without executing
#   APPROVAL_MODE    gemini approval mode (default: yolo)
#   SKIP_TESTS       If "true", skip /define-tests stage (for scaffold-only features)
#
# State is persisted to .runs/<feature>_define.state for crash recovery.

set -euo pipefail

# ──────────────────────────────────────────────────────────────────
# Config
# ──────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
AGENT_RUNNER="$SCRIPT_DIR/agent-run.sh"

RUNS_DIR="$REPO_ROOT/.runs"

MAX_ITERATIONS="${MAX_ITERATIONS:-3}"
APPROVAL_MODE="${APPROVAL_MODE:-yolo}"
SKIP_TESTS="${SKIP_TESTS:-false}"

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
${BOLD}define-until-solid.sh${RESET} — Autonomous definitional orchestrator (CodeRed)

${BOLD}Usage:${RESET}
  $0 <feature> [phase]

${BOLD}Arguments:${RESET}
  feature   Feature identifier, e.g. 001-monorepo-scaffold
  phase     Phase number for /define-tests (optional — runs all if omitted)

${BOLD}Prerequisites:${RESET}
  - specs/<feature>/spec.md exists (approved by human)
  - specs/<feature>/plan.md exists (approved by human)

${BOLD}Environment:${RESET}
  MAX_ITERATIONS=${MAX_ITERATIONS}    Max define→analyze cycles
  SKIP_TESTS=true    Skip /define-tests (scaffold-only features)
  DRY_RUN=true       Print stages without executing
  APPROVAL_MODE=yolo Override gemini approval mode

${BOLD}State Machine:${RESET}
  PLAN_TO_TASKS → CHECKLIST → ANALYZE → DEFINE_TESTS → DONE
  Loops back to PLAN_TO_TASKS on ANALYZE NOT READY verdict.
  Circuit breaker at ${MAX_ITERATIONS} iterations.
EOF
  exit "${1:-0}"
}

# ──────────────────────────────────────────────────────────────────
# Args
# ──────────────────────────────────────────────────────────────────
FEATURE="${1:-}"
PHASE="${2:-}"

if [[ -z "$FEATURE" ]]; then
  usage 1
fi

SPEC_DIR="specs/${FEATURE}"
if [[ ! -d "$REPO_ROOT/$SPEC_DIR" ]]; then
  echo -e "${RED}✗${RESET} Spec directory not found: ${SPEC_DIR}" >&2
  exit 1
fi

# Verify prerequisites
if [[ ! -f "$REPO_ROOT/$SPEC_DIR/spec.md" ]]; then
  echo -e "${RED}✗${RESET} spec.md not found. Run /specify first." >&2
  exit 1
fi

if [[ ! -f "$REPO_ROOT/$SPEC_DIR/plan.md" ]]; then
  echo -e "${RED}✗${RESET} plan.md not found. Run /plan first." >&2
  exit 1
fi

# ──────────────────────────────────────────────────────────────────
# State Persistence
# ──────────────────────────────────────────────────────────────────
mkdir -p "$RUNS_DIR"
STATE_FILE="$RUNS_DIR/${FEATURE}_define.state"
DUS_LOG="$RUNS_DIR/$(date +%Y-%m-%d_%H%M%S)_define_${FEATURE}.log"

save_state() {
  local stage="$1"
  local iteration="$2"
  cat > "$STATE_FILE" <<STATEJSON
{
  "stage": "${stage}",
  "iteration": ${iteration},
  "feature": "${FEATURE}",
  "phase": "${PHASE}",
  "updated_at": "$(date +%Y-%m-%dT%H:%M:%S%z)"
}
STATEJSON
}

load_state() {
  if [[ -f "$STATE_FILE" ]]; then
    STAGE=$(jq -r '.stage' "$STATE_FILE")
    ITERATION=$(jq -r '.iteration' "$STATE_FILE")
    if [[ "$STAGE" == "FAILED" ]] || [[ "$STAGE" == "CIRCUIT_BREAK" ]] || [[ "$STAGE" == "DONE" ]]; then
      echo -e "${YELLOW}⟳ Previous state was ${STAGE}. Resetting to PLAN_TO_TASKS iteration 1.${RESET}"
      STAGE="PLAN_TO_TASKS"
      ITERATION=1
    else
      echo -e "${YELLOW}⟳ Resuming from state: ${STAGE}, iteration ${ITERATION}${RESET}"
    fi
  else
    STAGE="PLAN_TO_TASKS"
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
  printf "${DIM}%s${RESET} ${color}[%s]${RESET} %s\n" "$ts" "$level" "$*" | tee -a "$DUS_LOG"
}

banner() {
  echo "" | tee -a "$DUS_LOG"
  echo -e "${MAGENTA}═══════════════════════════════════════════════${RESET}" | tee -a "$DUS_LOG"
  echo -e "${MAGENTA}  $1${RESET}" | tee -a "$DUS_LOG"
  echo -e "${MAGENTA}═══════════════════════════════════════════════${RESET}" | tee -a "$DUS_LOG"
  echo "" | tee -a "$DUS_LOG"
}

# ──────────────────────────────────────────────────────────────────
# Stage Executors
# ──────────────────────────────────────────────────────────────────
run_plan_to_tasks() {
  banner "PLAN-TO-TASKS — Iteration ${ITERATION}/${MAX_ITERATIONS}"
  log STAGE "Running agent-run.sh plan-to-tasks ${FEATURE}"
  save_state "PLAN_TO_TASKS" "$ITERATION"

  if ! APPROVAL_MODE="$APPROVAL_MODE" "$AGENT_RUNNER" plan-to-tasks "$FEATURE"; then
    log ERROR "plan-to-tasks failed (exit $?)"
    return 1
  fi

  # Verify outputs: tasks.json + gates generated
  if [[ ! -f "$REPO_ROOT/$SPEC_DIR/.gwrk/tasks.json" ]]; then
    log ERROR "No .gwrk/tasks.json generated"
    return 1
  fi

  if [[ ! -d "$REPO_ROOT/$SPEC_DIR/gates" ]]; then
    log WARN "No gates/ directory generated — gate-locked verification unavailable"
  else
    local gate_count
    gate_count=$(find "$REPO_ROOT/$SPEC_DIR/gates" -name '*-gate.sh' | wc -l | tr -d ' ')
    log OK "plan-to-tasks complete: tasks.json + ${gate_count} gate files"
  fi

  return 0
}

run_checklist() {
  banner "CHECKLIST — Iteration ${ITERATION}/${MAX_ITERATIONS}"
  log STAGE "Running agent-run.sh checklist ${FEATURE}"
  save_state "CHECKLIST" "$ITERATION"

  if ! APPROVAL_MODE="$APPROVAL_MODE" "$AGENT_RUNNER" checklist "$FEATURE"; then
    log ERROR "checklist generation failed (exit $?)"
    return 1
  fi

  log OK "Checklist generated"
  return 0
}

run_analyze() {
  banner "ANALYZE — Iteration ${ITERATION}/${MAX_ITERATIONS}"
  log STAGE "Running agent-run.sh analyze ${FEATURE}"
  save_state "ANALYZE" "$ITERATION"

  # /analyze is read-only — use plan mode so it can't modify files
  if ! APPROVAL_MODE="plan" "$AGENT_RUNNER" analyze "$FEATURE"; then
    log ERROR "analyze failed (exit $?)"
    return 1
  fi

  # Check for READY verdict in the log
  # /analyze reports "Verdict: READY" or "Verdict: NOT READY"
  # We grep the agent run log for the verdict
  local latest_log
  latest_log=$(ls -t "$RUNS_DIR"/*_analyze_"${FEATURE}"*.log 2>/dev/null | head -1)

  if [[ -z "$latest_log" ]]; then
    log WARN "Could not find analyze log — assuming NOT READY"
    return 1
  fi

  if grep -qi "Verdict:.*READY" "$latest_log" && ! grep -qi "Verdict:.*NOT READY" "$latest_log"; then
    log OK "Analyze verdict: READY"
    return 0
  else
    log WARN "Analyze verdict: NOT READY — will re-iterate"
    return 1
  fi
}

run_define_tests() {
  banner "DEFINE-TESTS"
  log STAGE "Running agent-run.sh define-tests ${FEATURE} ${PHASE:-all}"
  save_state "DEFINE_TESTS" "$ITERATION"

  if [[ -n "$PHASE" ]]; then
    if ! APPROVAL_MODE="$APPROVAL_MODE" "$AGENT_RUNNER" define-tests "$FEATURE" "$PHASE"; then
      log ERROR "define-tests failed (exit $?)"
      return 1
    fi
  else
    # Run for all phases found in .gwrk/tasks.json
    local phases
    phases=$(jq -r '.phases[].id' "$REPO_ROOT/$SPEC_DIR/.gwrk/tasks.json" 2>/dev/null | sed -E 's/^phase-//' || echo "")
    if [[ -z "$phases" ]]; then
      log WARN "No phases found in .gwrk/tasks.json — skipping define-tests"
      return 0
    fi
    for p in $phases; do
      log INFO "Defining tests for Phase ${p}..."
      if ! APPROVAL_MODE="$APPROVAL_MODE" "$AGENT_RUNNER" define-tests "$FEATURE" "$p"; then
        log ERROR "define-tests failed for Phase ${p}"
        return 1
      fi
    done
  fi

  log OK "Red tests committed"
  return 0
}

# Beads import has been removed along with the beads dependency.

# ──────────────────────────────────────────────────────────────────
# Pre-flight
# ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}┌─────────────────────────────────────────────────┐${RESET}"
echo -e "${CYAN}│${RESET}  ${BOLD}CodeRed Define-Until-Solid${RESET}                     ${CYAN}│${RESET}"
echo -e "${CYAN}├─────────────────────────────────────────────────┤${RESET}"
echo -e "${CYAN}│${RESET}  Feature:       ${BOLD}${FEATURE}${RESET}"
[[ -n "$PHASE" ]] && echo -e "${CYAN}│${RESET}  Phase:         ${PHASE}"
echo -e "${CYAN}│${RESET}  Max Cycles:    ${MAX_ITERATIONS}"
echo -e "${CYAN}│${RESET}  Skip Tests:    ${SKIP_TESTS}"
echo -e "${CYAN}│${RESET}  Approval:      ${APPROVAL_MODE}"
echo -e "${CYAN}│${RESET}  Log:           ${DIM}${DUS_LOG##*/}${RESET}"
echo -e "${CYAN}└─────────────────────────────────────────────────┘${RESET}"
echo ""

# Write log header
cat > "$DUS_LOG" <<HEADER
# CodeRed Define-Until-Solid Log
# ────────────────────────────────────────
# Feature   : ${FEATURE}
# Phase     : ${PHASE:-all}
# Max Iter  : ${MAX_ITERATIONS}
# Started   : $(date +%Y-%m-%dT%H:%M:%S%z)
# ────────────────────────────────────────

HEADER

# ──────────────────────────────────────────────────────────────────
# Dry run
# ──────────────────────────────────────────────────────────────────
if [[ "${DRY_RUN:-false}" == "true" ]]; then
  echo -e "${YELLOW}[DRY RUN]${RESET} Planned stages:"
  echo "  1. PLAN_TO_TASKS — generate tasks.json + verification gates"
  echo "  2. CHECKLIST — generate quality gate checklists"
  echo "  3. ANALYZE — cross-artifact consistency + TDD readiness"
  echo "     ↳ NOT READY: loop to PLAN_TO_TASKS (max ${MAX_ITERATIONS}x)"
  if [[ "$SKIP_TESTS" != "true" ]]; then
    echo "  4. DEFINE_TESTS — generate red test files from spec/plan/contracts"
  fi
  echo "  5. DONE"
  exit 0
fi

# ──────────────────────────────────────────────────────────────────
# Main State Machine
# ──────────────────────────────────────────────────────────────────
START_TIME=$(date +%s)
load_state

cd "$REPO_ROOT"

# Main loop
while [[ "$ITERATION" -le "$MAX_ITERATIONS" ]]; do

  # Stage: Plan-to-Tasks
  if [[ "$STAGE" == "PLAN_TO_TASKS" ]]; then
    if ! run_plan_to_tasks; then
      log ERROR "plan-to-tasks failed on iteration ${ITERATION}. Aborting."
      save_state "FAILED" "$ITERATION"
      exit 1
    fi
    STAGE="CHECKLIST"
  fi

  # Stage: Checklist
  if [[ "$STAGE" == "CHECKLIST" ]]; then
    if ! run_checklist; then
      log WARN "Checklist generation failed — continuing to analyze"
    fi
    STAGE="ANALYZE"
  fi

  # Stage: Analyze
  if [[ "$STAGE" == "ANALYZE" ]]; then
    if run_analyze; then
      # READY — proceed to tests
      if [[ "$SKIP_TESTS" == "true" ]]; then
        STAGE="DONE"
        break
      else
        STAGE="DEFINE_TESTS"
      fi
    else
      # NOT READY — loop back
      log WARN "Analyze NOT READY. Re-iterating (iteration $((ITERATION + 1)))..."
      ITERATION=$(( ITERATION + 1 ))
      if [[ "$ITERATION" -gt "$MAX_ITERATIONS" ]]; then
        log ERROR "Circuit breaker: max ${MAX_ITERATIONS} iterations reached."
        save_state "CIRCUIT_BREAK" "$ITERATION"
        exit 1
      fi
      STAGE="PLAN_TO_TASKS"
      continue
    fi
  fi

  # Stage: Define-Tests
  if [[ "$STAGE" == "DEFINE_TESTS" ]]; then
    if ! run_define_tests; then
      log ERROR "define-tests failed. Aborting."
      save_state "FAILED" "$ITERATION"
      exit 1
    fi
    STAGE="DONE"
    break
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
  echo -e "${GREEN}║${RESET}  ${BOLD}✓ DEFINE UNTIL SOLID — COMPLETE${RESET}                ${GREEN}║${RESET}"
  echo -e "${GREEN}╠═════════════════════════════════════════════════╣${RESET}"
  echo -e "${GREEN}║${RESET}  Feature:    ${FEATURE}"
  echo -e "${GREEN}║${RESET}  Iterations: ${ITERATION}/${MAX_ITERATIONS}"
  echo -e "${GREEN}║${RESET}  Duration:   ${BOLD}${TOTAL_MINS}m ${TOTAL_SECS}s${RESET}"
  echo -e "${GREEN}║${RESET}  Log:        ${DIM}${DUS_LOG##*/}${RESET}"
  echo -e "${GREEN}╠═════════════════════════════════════════════════╣${RESET}"
  echo -e "${GREEN}║${RESET}  ${BOLD}Next:${RESET} work-until-done.sh ${FEATURE} <phase>"
  echo -e "${GREEN}╚═════════════════════════════════════════════════╝${RESET}"
  log OK "DONE in ${TOTAL_MINS}m ${TOTAL_SECS}s after ${ITERATION} iteration(s)"

  # Clean up state file on success
  rm -f "$STATE_FILE"
  exit 0
else
  echo ""
  echo -e "${RED}╔═════════════════════════════════════════════════╗${RESET}"
  echo -e "${RED}║${RESET}  ${BOLD}✗ DEFINE UNTIL SOLID — FAILED${RESET}                  ${RED}║${RESET}"
  echo -e "${RED}╠═════════════════════════════════════════════════╣${RESET}"
  echo -e "${RED}║${RESET}  Feature:    ${FEATURE}"
  echo -e "${RED}║${RESET}  Stage:      ${STAGE}"
  echo -e "${RED}║${RESET}  Iteration:  ${ITERATION}/${MAX_ITERATIONS}"
  echo -e "${RED}║${RESET}  Duration:   ${BOLD}${TOTAL_MINS}m ${TOTAL_SECS}s${RESET}"
  echo -e "${RED}║${RESET}  State:      ${DIM}${STATE_FILE##*/}${RESET}"
  echo -e "${RED}║${RESET}  Log:        ${DIM}${DUS_LOG##*/}${RESET}"
  echo -e "${RED}╚═════════════════════════════════════════════════╝${RESET}"
  exit 1
fi

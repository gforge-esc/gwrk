#!/usr/bin/env bash
# wud-ci-wait.sh — Deterministic CI/CD gate for work-until-done
#
# Waits for all PR checks to pass using `gh pr checks --watch`.
# Returns success/failure with details on which checks failed.
#
# Usage: ./scripts/dev/wud-ci-wait.sh <pr_number> [timeout_minutes]
#
# Arguments:
#   pr_number         GitHub PR number
#   timeout_minutes   Max wait time in minutes (default: 30)
#
# Exit codes:
#   0 - All checks passed
#   1 - One or more checks failed
#   2 - Timeout or error

set -euo pipefail

PR_NUMBER="${1:-}"
TIMEOUT_MINS="${2:-30}"

if [[ -z "$PR_NUMBER" ]]; then
  echo "Usage: $0 <pr_number> [timeout_minutes]" >&2
  exit 2
fi

if ! command -v gh &>/dev/null; then
  echo "[wud-ci-wait] ERROR: gh CLI not found" >&2
  exit 2
fi

echo "[wud-ci-wait] Waiting for CI on PR #${PR_NUMBER} (timeout: ${TIMEOUT_MINS}m)..."

# gh pr checks --watch blocks until all checks complete or fail
# --fail-fast exits on first failure
TIMEOUT_SECS=$(( TIMEOUT_MINS * 60 ))

if timeout "$TIMEOUT_SECS" gh pr checks "$PR_NUMBER" --watch 2>&1; then
  echo "[wud-ci-wait] ✓ All checks passed on PR #${PR_NUMBER}"
  exit 0
else
  EXIT=$?
  if [[ "$EXIT" -eq 124 ]]; then
    echo "[wud-ci-wait] ✗ Timeout after ${TIMEOUT_MINS} minutes" >&2
    exit 2
  fi

  echo "[wud-ci-wait] ✗ CI checks failed on PR #${PR_NUMBER}" >&2
  echo ""
  
  # Check for "no checks reported" edge case
  RESULT=$(gh pr checks "$PR_NUMBER" 2>&1 || true)
  if echo "$RESULT" | grep -q "no checks reported"; then
    echo "[wud-ci-wait] ! No checks reported on PR #${PR_NUMBER}"
    if [ ! -d ".github/workflows" ]; then
      echo "[wud-ci-wait] ✓ No .github/workflows found. Treating as PASS for early scaffolding."
      exit 0
    fi
  fi

  echo "[wud-ci-wait] Failed checks:"
  echo "$RESULT" | grep -E "fail|error" || true
  exit 1
fi

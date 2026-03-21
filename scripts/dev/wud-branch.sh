#!/usr/bin/env bash
# wud-branch.sh — Deterministic branch management for work-until-done
#
# Ensures the correct feat/* branch exists and is checked out.
# Creates from main if it doesn't exist. Pushes to origin.
#
# Usage: ./scripts/dev/wud-branch.sh <feature_name> [push]
#
# Arguments:
#   feature_name   e.g. 001-pipeline-setup
#   push           If "push", pushes the branch to origin after checkout
#
# Exit codes:
#   0 - On correct branch (created or already existed)
#   1 - Error

set -euo pipefail

FEATURE="${1:-}"
ACTION="${2:-}"

if [[ -z "$FEATURE" ]]; then
  echo "Usage: $0 <feature_name> [push]" >&2
  exit 1
fi

BRANCH="feat/${FEATURE}"
CURRENT=$(git branch --show-current)

# FR-002: Auto-commit run state files, then dirty-tree fail-fast.
# .gwrk/runs/*.json files are ship lifecycle artifacts (dispatch records,
# timing data) created by `gwrk ship` between phases. They must be homed
# (committed) so they don't block multi-phase shipping.
RUN_FILES=$(git ls-files --others --exclude-standard -- 'specs/*/.gwrk/runs/*.json' '.gwrk/runs/*.json' 2>/dev/null || true)
if [[ -n "$RUN_FILES" ]]; then
  git add -- $RUN_FILES
  git commit -m "chore: home run state files from ship lifecycle" --no-verify >/dev/null 2>&1
  echo "[wud-branch] ✓ Homed run state files"
fi

# FR-002: Dirty-tree fail-fast — refuse to ship if working tree is dirty
DIRTY=$(git status --porcelain 2>/dev/null)
if [[ -n "$DIRTY" ]]; then
  echo "Dirty working tree — commit or stash before shipping" >&2
  exit 1
fi

if [[ "$CURRENT" == "$BRANCH" ]]; then
  echo "[wud-branch] ✓ Already on $BRANCH"
else
  # Check if branch exists locally
  if git show-ref --verify --quiet "refs/heads/$BRANCH" 2>/dev/null; then
    echo "[wud-branch] Switching to existing branch $BRANCH"
    git checkout "$BRANCH"
  elif git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
    echo "[wud-branch] Tracking remote branch $BRANCH"
    git checkout -b "$BRANCH" "origin/$BRANCH"
  else
    echo "[wud-branch] Creating new branch $BRANCH from develop"
    git checkout -b "$BRANCH" develop
  fi
fi

if [[ "$ACTION" == "push" ]]; then
  echo "[wud-branch] Pushing $BRANCH to origin..."
  git push origin "$BRANCH" --force-with-lease 2>/dev/null || {
    echo "[wud-branch] Push failed. Pulling and retrying..."
    git pull --rebase origin "$BRANCH" 2>/dev/null || true
    git push origin "$BRANCH"
  }
  echo "[wud-branch] ✓ Pushed"
fi

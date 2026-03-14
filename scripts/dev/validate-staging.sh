#!/usr/bin/env bash
# validate-staging.sh — Pre-push staging scope validation
#
# Called by agent-run.sh after the agent completes, before WUD pushes.
# Rejects commits that include files outside the expected scope.
#
# Design Mandate Rule 5: Agents must not git add . blindly.
#
# Usage:
#   ./scripts/dev/validate-staging.sh <feature>
#
# Exit codes:
#   0 — staging scope is clean
#   1 — violations detected (agent must clean up before push)

set -euo pipefail

BOLD=$'\033[1m'
RED=$'\033[31m'
YELLOW=$'\033[33m'
GREEN=$'\033[32m'
DIM=$'\033[2m'
RESET=$'\033[0m'

FEATURE="${1:-}"
if [[ -z "$FEATURE" ]]; then
  echo -e "${RED}✗${RESET} Usage: validate-staging.sh <feature>" >&2
  exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

VIOLATIONS=()

# ──────────────────────────────────────────────────────────────────
# Check 1: No orphan files in repo root
# ──────────────────────────────────────────────────────────────────
# Files that should never be committed (agent artifacts)
ORPHAN_PATTERNS=("=" "*.tmp" "*.bak")
for pattern in "${ORPHAN_PATTERNS[@]}"; do
  while IFS= read -r file; do
    if [[ -n "$file" ]] && git ls-files --error-unmatch "$file" &>/dev/null 2>&1; then
      # Already tracked — staged for removal?
      :
    elif git diff --cached --name-only 2>/dev/null | grep -qxF "$file"; then
      VIOLATIONS+=("Orphan staged: $file")
    fi
  done < <(find . -maxdepth 1 -name "$pattern" -type f 2>/dev/null | sed 's|^\./||')
done

# ──────────────────────────────────────────────────────────────────
# Check 2: No orphan spec directories (spec dir without spec.md)
# ──────────────────────────────────────────────────────────────────
for dir in specs/*/; do
  dir="${dir%/}"
  [[ ! -d "$dir" ]] && continue
  dirname="$(basename "$dir")"

  # Skip build-plan and known non-spec dirs
  [[ "$dirname" == "000-build-plan.md" ]] && continue

  # Check if it looks like a spec dir (has digits prefix)
  if [[ "$dirname" =~ ^[0-9]+ ]]; then
    if [[ ! -f "$dir/spec.md" ]]; then
      # Only flag if it has staged changes
      if git diff --cached --name-only 2>/dev/null | grep -q "^$dir/"; then
        VIOLATIONS+=("Orphan spec dir staged (no spec.md): $dir")
      fi
    fi
  else
    # Non-numeric spec dirs are suspicious
    if git diff --cached --name-only 2>/dev/null | grep -q "^$dir/"; then
      VIOLATIONS+=("Non-standard spec dir staged: $dir")
    fi
  fi
done

# ──────────────────────────────────────────────────────────────────
# Check 3: Staged files outside expected scope
# ──────────────────────────────────────────────────────────────────
ALLOWED_PREFIXES=(
  "src/"
  "specs/${FEATURE}/"
  "specs/000-build-plan.md"
  "docs/"
  "scripts/"
  "test/"
  ".gwrk/"
  ".gwrkrc.json"
  "package.json"
  "pnpm-lock.yaml"
  "tsconfig.json"
  "biome.json"
  "dist/"
)

while IFS= read -r file; do
  [[ -z "$file" ]] && continue
  allowed=false
  for prefix in "${ALLOWED_PREFIXES[@]}"; do
    if [[ "$file" == "$prefix"* ]] || [[ "$file" == "$prefix" ]]; then
      allowed=true
      break
    fi
  done
  if ! $allowed; then
    VIOLATIONS+=("Out-of-scope file staged: $file")
  fi
done < <(git diff --cached --name-only 2>/dev/null)

# ──────────────────────────────────────────────────────────────────
# Report
# ──────────────────────────────────────────────────────────────────
if [[ ${#VIOLATIONS[@]} -gt 0 ]]; then
  echo ""
  echo -e "${RED}${BOLD}✗ Staging validation FAILED${RESET}"
  echo -e "${DIM}────────────────────────────────────────${RESET}"
  for v in "${VIOLATIONS[@]}"; do
    echo -e "  ${YELLOW}⚠${RESET}  $v"
  done
  echo ""
  echo -e "${DIM}Fix: git reset the offending files, then re-stage only in-scope changes.${RESET}"
  exit 1
fi

echo -e "${GREEN}✓${RESET} Staging validation passed (feature: ${FEATURE})"
exit 0

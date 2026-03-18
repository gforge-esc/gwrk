#!/usr/bin/env bash
# TR-008: validate-staging.sh red tests

set -euo pipefail

ROOT=$(pwd)
VALIDATOR="$ROOT/scripts/dev/validate-staging.sh"
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

# Mock git
git() {
  if [[ "$1" == "status" && "$2" == "--porcelain" ]]; then
    cat "$TEMP_DIR/staged_files"
  else
    command git "$@"
  fi
}
export -f git

echo "Running TR-008: validate-staging.sh red tests..."

# US-010: Out-of-scope files
echo "Scenario 1: Out-of-scope files staged"
echo " M src/unrelated.ts" > "$TEMP_DIR/staged_files"
if "$VALIDATOR" 004-ship-loop 2>/dev/null; then
  echo "FAIL: Expected rejection for out-of-scope files"
  exit 1
fi
echo "PASS: Rejected out-of-scope files"

# US-010: Build plan protection
echo "Scenario 2: Build plan staged"
echo " M specs/000-build-plan.md" > "$TEMP_DIR/staged_files"
if "$VALIDATOR" 004-ship-loop 2>/dev/null; then
  echo "FAIL: Expected rejection for build plan modification"
  exit 1
fi
echo "PASS: Rejected build plan modification"

# US-010: In-scope files
echo "Scenario 3: Only in-scope files staged"
echo " M src/commands/ship.ts" > "$TEMP_DIR/staged_files"
echo " M scripts/dev/work-until-done.sh" >> "$TEMP_DIR/staged_files"
if ! "$VALIDATOR" 004-ship-loop; then
  echo "FAIL: Expected acceptance for in-scope files"
  exit 1
fi
echo "PASS: Accepted in-scope files"

echo "ALL TR-008 SCENARIOS PASSED"

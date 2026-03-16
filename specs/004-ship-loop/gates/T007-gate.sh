#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T007 — Implement scripts/dev/work-until-done.sh

FILE="scripts/dev/work-until-done.sh"

# Assertion 1: CIRCUIT_BREAK emit_event call exists
grep -q "emit_event \"CIRCUIT_BREAK: .*\"" "$FILE"

# Assertion 2: failureContext is written to state file in CIRCUIT_BREAK block
grep -q "\"failureContext\": {" "$FILE"
grep -q "save_state \"CIRCUIT_BREAK\"" "$FILE"

# Assertion 3: Staging validation call exists after IMPLEMENT
grep -q "Running staging validation..." "$FILE"
grep -q "bash \"\$validate_staging\" \"\$FEATURE\"" "$FILE"

# Assertion 4: Dirty-tree guard via wud-branch.sh call in BRANCH_SETUP
grep -q "Ensuring feat/.* branch..." "$FILE"
grep -q "\"\$WUD_BRANCH\" \"\$FEATURE\"" "$FILE"

echo "PASS: T007 — scripts/dev/work-until-done.sh Phase 2 features verified"

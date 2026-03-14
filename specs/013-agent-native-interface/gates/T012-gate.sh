#!/bin/bash
set -euo pipefail
# Gate: T012 — Implement error-as-navigation across all commands
# Source: spec FR-007
# AUTHORED

# Assertion #1: Missing feature triggers corrective suggestion
gwrk tasks list nonexistent 2>&1 | grep -q "Run '" || { echo "FAIL: tasks list error missing 'Run' suggestion"; exit 1; }

# Assertion #2: Missing spec triggers corrective suggestion
gwrk define plan nonexistent 2>&1 | grep -q "Run '" || { echo "FAIL: define plan error missing 'Run' suggestion"; exit 1; }

# Assertion #3: Unknown command triggers help suggestion
gwrk xyz-nonexistent 2>&1 | grep -qiE "help|Run " || { echo "FAIL: unknown command error missing help suggestion"; exit 1; }

# Assertion #4: Spot check — at least 10 error paths contain "Run '"
COUNT=$(grep -rn "Run '" src/commands/*.ts | grep -v test | wc -l | tr -d ' ')
[ "$COUNT" -ge 10 ] || { echo "FAIL: only $COUNT 'Run' suggestions found — need ≥10"; exit 1; }

echo "PASS: T012 — Implement error-as-navigation across all commands"

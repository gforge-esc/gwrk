#!/bin/bash
# T013: Implement src/commands/plan.ts (Phase 3 subcommands)
# Gate: EXECUTE the commands, not just grep for registration.
set -e

# Seed the plan first so guardEmpty doesn't block
node dist/cli.js plan init 2>/dev/null || true

# 1. plan add feature — should exit 0 and print confirmation
OUTPUT=$(node dist/cli.js plan add feature F999 "Gate Test Feature" 2>&1)
echo "$OUTPUT" | grep -q "Added feature"

# 2. plan add phase — should exit 0
OUTPUT=$(node dist/cli.js plan add phase P999-01 "Gate Test Phase" --feature-id F999 2>&1)
echo "$OUTPUT" | grep -q "Added phase"

# 3. plan dep add — should exit 0
OUTPUT=$(node dist/cli.js plan dep add F999 F001 2>&1)
echo "$OUTPUT" | grep -q "Added"

# 4. plan dep remove — should exit 0
OUTPUT=$(node dist/cli.js plan dep remove F999 F001 2>&1)
echo "$OUTPUT" | grep -q "Removed"

# 5. plan set — should exit 0
OUTPUT=$(node dist/cli.js plan set P999-01 --status IN_PROGRESS 2>&1)
echo "$OUTPUT" | grep -q "Updated phase"

# 6. plan remove phase — should exit 0
OUTPUT=$(node dist/cli.js plan remove P999-01 2>&1)
echo "$OUTPUT" | grep -q "Removed phase"

# 7. plan remove feature — should exit 0
OUTPUT=$(node dist/cli.js plan remove F999 --type feature 2>&1)
echo "$OUTPUT" | grep -q "Removed feature"

# 8. Negative: plan add with bad type — should fail
if node dist/cli.js plan add badtype X 2>/dev/null; then
  echo "FAIL: plan add should reject unknown type"
  exit 1
fi

echo "T013: Phase 3 subcommands fully functional."
#!/bin/bash
# T021: Implement src/commands/plan.ts (Phase 4 subcommands)
# Gate: EXECUTE the commands, not just grep for registration.
set -e

# Seed the plan
node dist/cli.js plan init 2>/dev/null || true

# 1. plan verify — should exit 0 (not throw "not implemented")
OUTPUT=$(node dist/cli.js plan verify 2>&1)
if echo "$OUTPUT" | grep -q "not yet implemented"; then
  echo "FAIL: plan verify is still a stub"
  exit 1
fi

# 2. plan render --stdout — should produce markdown
OUTPUT=$(node dist/cli.js plan render --stdout 2>&1)
echo "$OUTPUT" | grep -q "Build Plan"

echo "T021: Phase 4 subcommands (verify, render) fully functional."
#!/bin/bash
# T010: Implement src/commands/plan.ts (Phase 2 subcommands)
set -e
FILE="src/commands/plan.ts"
grep -q "\.command(\"next\")" "$FILE"
grep -q "\.command(\"critical\")" "$FILE"
grep -q "\.command(\"waves\")" "$FILE"
echo "T010: Phase 2 subcommands added to CLI."
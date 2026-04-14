#!/bin/bash
# T025: Implement src/commands/plan.ts (Phase 5 subcommands)
set -e
FILE="src/commands/plan.ts"
grep -q "\.command(\"viz\")" "$FILE"
grep -q "\.command(\"review\")" "$FILE"
echo "T025: Phase 5 subcommands added to CLI."
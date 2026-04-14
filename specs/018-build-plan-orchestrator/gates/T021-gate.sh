#!/bin/bash
# T021: Implement src/commands/plan.ts (Phase 4 subcommands)
set -e
FILE="src/commands/plan.ts"
grep -q "\.command(\"verify\")" "$FILE"
grep -q "\.command(\"render\")" "$FILE"
echo "T021: Phase 4 subcommands added to CLI."
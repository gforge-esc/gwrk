#!/bin/bash
# T013: Implement src/commands/plan.ts (Phase 3 subcommands)
set -e
FILE="src/commands/plan.ts"
grep -q "\.command(\"add <type> <id> \[name\]\")" "$FILE"
grep -q "\.command(\"remove <id>\")" "$FILE"
grep -q "\.command(\"dep <action> <from> <to>\")" "$FILE"
grep -q "\.command(\"set <id>\")" "$FILE"
echo "T013: Phase 3 subcommands added to CLI."
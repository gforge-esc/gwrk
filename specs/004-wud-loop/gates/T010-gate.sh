#!/usr/bin/env bash
# Gate: T010 — Register implement and wud commands in cli.ts
# Contract: plan.md Phase 3
set -euo pipefail

FILE="src/cli.ts"

# #1 File must exist
test -f "$FILE" || { echo "FAIL #1: $FILE does not exist" >&2; exit 1; }

# #2 Must import implementCommand
grep -q 'implementCommand\|implement.*Command' "$FILE" || \
  { echo "FAIL #2: implementCommand not imported in cli.ts" >&2; exit 1; }

# #3 Must import wudCommand
grep -q 'wudCommand\|wud.*Command' "$FILE" || \
  { echo "FAIL #3: wudCommand not imported in cli.ts" >&2; exit 1; }

# #4 Must register implementCommand via addCommand
IMPLEMENT_REGISTERED=$(grep -c 'addCommand.*implement\|addCommand.*implementCommand' "$FILE" || true)
if [[ "$IMPLEMENT_REGISTERED" -eq 0 ]]; then
  echo "FAIL #4: implementCommand not registered via addCommand" >&2
  exit 1
fi

# #5 Must register wudCommand via addCommand
WUD_REGISTERED=$(grep -c 'addCommand.*wud\|addCommand.*wudCommand' "$FILE" || true)
if [[ "$WUD_REGISTERED" -eq 0 ]]; then
  echo "FAIL #5: wudCommand not registered via addCommand" >&2
  exit 1
fi

echo "PASS: T010 — cli.ts imports and registers implement + wud commands"

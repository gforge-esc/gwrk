#!/bin/bash
# AUTHORED
set -euo pipefail

# T052: Implement src/plugins/builtins/skills/typescript-standards/SKILL.md
FILE="src/plugins/builtins/skills/typescript-standards/SKILL.md"

test -f "$FILE" \
  || { echo "FAIL: T052 — file not found: $FILE" >&2; exit 1; }

grep -q "any" "$FILE" \
  || { echo "FAIL: T052 — $FILE missing 'any' restriction" >&2; exit 1; }

grep -q "ESM" "$FILE" \
  || { echo "FAIL: T052 — $FILE missing 'ESM' conventions" >&2; exit 1; }

echo "PASS: T052 — src/plugins/builtins/skills/typescript-standards/SKILL.md exists and contains standards"
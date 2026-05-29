#!/bin/bash
# AUTHORED
set -euo pipefail

# T050: Implement src/plugins/builtins/skills/gwrk-conventions/SKILL.md
FILE="src/plugins/builtins/skills/gwrk-conventions/SKILL.md"

test -f "$FILE" \
  || { echo "FAIL: T050 — file not found: $FILE" >&2; exit 1; }

grep -q "completed" "$FILE" \
  || { echo "FAIL: T050 — $FILE missing 'completed' status" >&2; exit 1; }

grep -q "tasks.json" "$FILE" \
  || { echo "FAIL: T050 — $FILE missing 'tasks.json' reference" >&2; exit 1; }

echo "PASS: T050 — src/plugins/builtins/skills/gwrk-conventions/SKILL.md exists and contains conventions"
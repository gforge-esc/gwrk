#!/bin/bash
# AUTHORED
set -euo pipefail

# T053: Implement src/plugins/builtins/skills/typescript-standards/manifest.yaml
FILE="src/plugins/builtins/skills/typescript-standards/manifest.yaml"

test -f "$FILE" \
  || { echo "FAIL: T053 — file not found: $FILE" >&2; exit 1; }

grep -q "type: skill" "$FILE" \
  || { echo "FAIL: T053 — $FILE missing 'type: skill'" >&2; exit 1; }

grep -q "tier: enforcement" "$FILE" \
  || { echo "FAIL: T053 — $FILE missing 'tier: enforcement'" >&2; exit 1; }

grep -q "scope: implementation" "$FILE" \
  || { echo "FAIL: T053 — $FILE missing 'scope: implementation'" >&2; exit 1; }

echo "PASS: T053 — src/plugins/builtins/skills/typescript-standards/manifest.yaml exists and is correct"
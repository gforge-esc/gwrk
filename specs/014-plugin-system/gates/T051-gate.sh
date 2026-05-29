#!/bin/bash
# AUTHORED
set -euo pipefail

# T051: Implement src/plugins/builtins/skills/gwrk-conventions/manifest.yaml
FILE="src/plugins/builtins/skills/gwrk-conventions/manifest.yaml"

test -f "$FILE" \
  || { echo "FAIL: T051 — file not found: $FILE" >&2; exit 1; }

grep -q "type: skill" "$FILE" \
  || { echo "FAIL: T051 — $FILE missing 'type: skill'" >&2; exit 1; }

grep -q "tier: enforcement" "$FILE" \
  || { echo "FAIL: T051 — $FILE missing 'tier: enforcement'" >&2; exit 1; }

grep -q "scope: implementation" "$FILE" \
  || { echo "FAIL: T051 — $FILE missing 'scope: implementation'" >&2; exit 1; }

echo "PASS: T051 — src/plugins/builtins/skills/gwrk-conventions/manifest.yaml exists and is correct"
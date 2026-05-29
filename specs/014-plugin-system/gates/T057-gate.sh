#!/bin/bash
# AUTHORED
set -euo pipefail

# T057: Implement src/plugins/builtins/workflows/gwrk-implement/PROMPT.md (replace placeholder)
FILE="src/plugins/builtins/workflows/gwrk-implement/PROMPT.md"

test -f "$FILE" \
  || { echo "FAIL: T057 — file not found: $FILE" >&2; exit 1; }

grep -q "{{enforcement}}" "$FILE" \
  || { echo "FAIL: T057 — $FILE missing '{{enforcement}}' marker" >&2; exit 1; }

grep -v -q "<code_quality>" "$FILE" \
  || { echo "FAIL: T057 — $FILE still contains legacy '<code_quality>' placeholder" >&2; exit 1; }

echo "PASS: T057 — src/plugins/builtins/workflows/gwrk-implement/PROMPT.md uses {{enforcement}} marker"
#!/bin/bash
# AUTHORED
set -euo pipefail

# T057: src/plugins/builtins/workflows/gwrk-implement/PROMPT.md (MODIFY: replace <code_quality> with {{enforcement}})
test -f src/plugins/builtins/workflows/gwrk-implement/PROMPT.md \
  || { echo "FAIL: T057 — file not found: src/plugins/builtins/workflows/gwrk-implement/PROMPT.md" >&2; exit 1; }

grep -q "{{enforcement}}" src/plugins/builtins/workflows/gwrk-implement/PROMPT.md \
  || { echo "FAIL: T057 — src/plugins/builtins/workflows/gwrk-implement/PROMPT.md missing '{{enforcement}}' marker" >&2; exit 1; }

echo "PASS: T057 — Implement src/plugins/builtins/workflows/gwrk-implement/PROMPT.md"

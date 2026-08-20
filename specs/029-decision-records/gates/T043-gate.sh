#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T043 — Modify PROMPT.md
# Generated from filesystem convention (deterministic vitest gate)

test -f src/plugins/builtins/workflows/gwrk-analyze/PROMPT.md || { echo "FAIL: T043 — file not found: src/plugins/builtins/workflows/gwrk-analyze/PROMPT.md" >&2; exit 1; }

pnpm vitest run src/plugins/builtins/workflows/gwrk-analyze/PROMPT.md --reporter=verbose \
  || { echo "FAIL: T043 — vitest failed for src/plugins/builtins/workflows/gwrk-analyze/PROMPT.md" >&2; exit 1; }

echo "PASS: T043 — Modify PROMPT.md"

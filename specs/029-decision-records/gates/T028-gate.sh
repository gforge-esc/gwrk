#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T028 — Modify PROMPT.md
# Generated from filesystem convention (deterministic vitest gate)

test -f src/plugins/builtins/workflows/gwrk-plan/PROMPT.md || { echo "FAIL: T028 — file not found: src/plugins/builtins/workflows/gwrk-plan/PROMPT.md" >&2; exit 1; }

pnpm vitest run src/plugins/builtins/workflows/gwrk-plan/PROMPT.md --reporter=verbose \
  || { echo "FAIL: T028 — vitest failed for src/plugins/builtins/workflows/gwrk-plan/PROMPT.md" >&2; exit 1; }

echo "PASS: T028 — Modify PROMPT.md"

#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T029 — Modify PROMPT.md
# Generated from filesystem convention (deterministic vitest gate)

test -f src/plugins/builtins/workflows/gwrk-specify/PROMPT.md || { echo "FAIL: T029 — file not found: src/plugins/builtins/workflows/gwrk-specify/PROMPT.md" >&2; exit 1; }

pnpm vitest run src/plugins/builtins/workflows/gwrk-specify/PROMPT.md --reporter=verbose \
  || { echo "FAIL: T029 — vitest failed for src/plugins/builtins/workflows/gwrk-specify/PROMPT.md" >&2; exit 1; }

echo "PASS: T029 — Modify PROMPT.md"

#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T042 — Modify PROMPT.md
# Generated from filesystem convention (deterministic vitest gate)

test -f src/plugins/builtins/workflows/gwrk-constitution/PROMPT.md || { echo "FAIL: T042 — file not found: src/plugins/builtins/workflows/gwrk-constitution/PROMPT.md" >&2; exit 1; }

pnpm vitest run src/plugins/builtins/workflows/gwrk-constitution/PROMPT.md --reporter=verbose \
  || { echo "FAIL: T042 — vitest failed for src/plugins/builtins/workflows/gwrk-constitution/PROMPT.md" >&2; exit 1; }

echo "PASS: T042 — Modify PROMPT.md"

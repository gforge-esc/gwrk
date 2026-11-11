#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T002 — Modify PROMPT.md
# Generated from filesystem convention (no test file found)

test -f src/plugins/builtins/workflows/gwrk-plan/PROMPT.md || { echo "FAIL: T002 — file not found: src/plugins/builtins/workflows/gwrk-plan/PROMPT.md" >&2; exit 1; }

echo "PASS: T002 — Modify PROMPT.md"

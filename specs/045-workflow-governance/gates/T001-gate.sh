#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T001 — Modify PROMPT.md
# Generated from filesystem convention (no test file found)

test -f src/plugins/builtins/workflows/gwrk-specify/PROMPT.md || { echo "FAIL: T001 — file not found: src/plugins/builtins/workflows/gwrk-specify/PROMPT.md" >&2; exit 1; }

echo "PASS: T001 — Modify PROMPT.md"

#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T003 — Modify principal-engineer.md
# Generated from filesystem convention (no test file found)

test -f src/plugins/builtins/personas/principal-engineer.md || { echo "FAIL: T003 — file not found: src/plugins/builtins/personas/principal-engineer.md" >&2; exit 1; }

echo "PASS: T003 — Modify principal-engineer.md"

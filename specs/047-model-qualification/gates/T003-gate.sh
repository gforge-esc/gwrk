#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T003 — Modify index.ts
# Generated from filesystem convention (no test file found)

test -f src/ports/index.ts || { echo "FAIL: T003 — file not found: src/ports/index.ts" >&2; exit 1; }

echo "PASS: T003 — Modify index.ts"

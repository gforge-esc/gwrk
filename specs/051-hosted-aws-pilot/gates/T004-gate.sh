#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T004 — Modify index.ts
# Generated from filesystem convention (no test file found)

test -f src/ports/index.ts || { echo "FAIL: T004 — file not found: src/ports/index.ts" >&2; exit 1; }

echo "PASS: T004 — Modify index.ts"

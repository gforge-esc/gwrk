#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T010 — Modify index.ts
# Generated from filesystem convention (no test file found)

test -f src/adapters/sqlite/index.ts || { echo "FAIL: T010 — file not found: src/adapters/sqlite/index.ts" >&2; exit 1; }

echo "PASS: T010 — Modify index.ts"

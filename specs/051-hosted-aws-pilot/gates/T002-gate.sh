#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T002 — Modify index.ts
# Generated from filesystem convention (no test file found)

test -f src/domain/index.ts || { echo "FAIL: T002 — file not found: src/domain/index.ts" >&2; exit 1; }

echo "PASS: T002 — Modify index.ts"

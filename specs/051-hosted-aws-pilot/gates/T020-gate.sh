#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T020 — Modify index.ts
# Generated from filesystem convention (no test file found)

test -f src/application/index.ts || { echo "FAIL: T020 — file not found: src/application/index.ts" >&2; exit 1; }

echo "PASS: T020 — Modify index.ts"

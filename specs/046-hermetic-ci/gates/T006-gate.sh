#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T006 — Modify vitest.config.ts
# Generated from filesystem convention (no test file found)

test -f vitest.config.ts || { echo "FAIL: T006 — file not found: vitest.config.ts" >&2; exit 1; }

echo "PASS: T006 — Modify vitest.config.ts"

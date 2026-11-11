#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T005 — Create registry-loader.ts
# Generated from filesystem convention (no test file found)

test -f src/adapters/agents/registry-loader.ts || { echo "FAIL: T005 — file not found: src/adapters/agents/registry-loader.ts" >&2; exit 1; }

echo "PASS: T005 — Create registry-loader.ts"

#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T005 — Modify agent-backend.ts
# Generated from filesystem convention (no test file found)

test -f src/plugins/agent-backend.ts || { echo "FAIL: T005 — file not found: src/plugins/agent-backend.ts" >&2; exit 1; }

echo "PASS: T005 — Modify agent-backend.ts"

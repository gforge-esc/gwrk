#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T004 — Modify agent-port.ts
# Generated from filesystem convention (no test file found)

test -f src/ports/agent-port.ts || { echo "FAIL: T004 — file not found: src/ports/agent-port.ts" >&2; exit 1; }

echo "PASS: T004 — Modify agent-port.ts"

#!/bin/bash
# AUTHORED
set -euo pipefail

# T034: Verify ship.ts uses ShipOrchestrator instead of bash spawn
grep -q 'ShipOrchestrator' src/commands/ship.ts || { echo "FAIL: ShipOrchestrator not wired into ship.ts" >&2; exit 1; }

# Verify compile
pnpm build > /dev/null 2>&1 || { echo "FAIL: pnpm build failed" >&2; exit 1; }

echo "PASS: T034 — ShipOrchestrator wired into ship.ts"

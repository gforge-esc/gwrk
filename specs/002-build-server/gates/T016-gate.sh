#!/bin/bash
set -euo pipefail
# AUTHORED
test -f src/engine/plan-store.ts || { echo "FAIL: T016 — file not found: src/engine/plan-store.ts" >&2; exit 1; }
grep -q 'handleShipComplete' src/engine/plan-store.ts || { echo "FAIL: T016 — src/engine/plan-store.ts missing 'handleShipComplete'" >&2; exit 1; }
echo "PASS: T016 — Implement src/engine/plan-store.ts"

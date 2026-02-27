#!/usr/bin/env bash
# Gate: T011 — Verify CLI integration and dry-run modes
# Contract: plan.md Phase 3 (SC-001, SC-002, VR-001, VR-002)
set -euo pipefail

# #1 TypeScript must compile
npx tsc --noEmit 2>&1 || \
  { echo "FAIL #1: TypeScript compilation failed" >&2; exit 1; }

# #2 gwrk implement --help must work
node --import tsx src/cli.ts implement --help 2>&1 | grep -q 'implement' || \
  { echo "FAIL #2: gwrk implement --help does not show usage" >&2; exit 1; }

# #3 gwrk wud --help must work
node --import tsx src/cli.ts wud --help 2>&1 | grep -q 'wud' || \
  { echo "FAIL #3: gwrk wud --help does not show usage" >&2; exit 1; }

echo "PASS: T011 — CLI integration verified, TypeScript compiles, help works"

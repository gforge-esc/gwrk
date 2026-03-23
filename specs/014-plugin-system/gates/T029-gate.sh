#!/bin/bash
# AUTHORED
set -euo pipefail

# Task T029: Test strategy for Phase 4
# Includes compile gate (pnpm build) to catch TypeScript errors

# Assertion 0: Compile gate — TypeScript MUST build cleanly
pnpm build \
  || { echo "FAIL: T029 — pnpm build failed. Fix all TypeScript compilation errors before shipping." >&2; exit 1; }

# Assertion 1: Phase 4 unit tests exist
test -f "src/engine/router.test.ts" \
  || { echo "FAIL: T029 — file not found: src/engine/router.test.ts" >&2; exit 1; }

# Assertion 2: Critical test cases (FR-P4-001, FR-P4-002)
grep -q "selectBackend" "src/engine/router.test.ts" \
  || { echo "FAIL: T029 — router.test.ts missing 'selectBackend' test case (FR-P4-001)" >&2; exit 1; }

grep -q "fallbackOrder\|fallback" "src/engine/router.test.ts" \
  || { echo "FAIL: T029 — router.test.ts missing fallback test case (FR-P4-001)" >&2; exit 1; }

# Assertion 3: Run Phase 4 unit tests
pnpm vitest run src/engine/router.test.ts --reporter=verbose \
  || { echo "FAIL: T029 — vitest failed for router.test.ts" >&2; exit 1; }

echo "PASS: T029 — Implement test strategy for Phase 4"

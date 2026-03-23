#!/bin/bash
# AUTHORED
set -euo pipefail

# Task T023: Test strategy for Phase 3
# Includes compile gate (pnpm build) to catch TypeScript errors

# Assertion 0: Compile gate — TypeScript MUST build cleanly
pnpm build \
  || { echo "FAIL: T023 — pnpm build failed. Fix all TypeScript compilation errors before shipping." >&2; exit 1; }

# Assertion 1: Phase 3 unit tests exist
test -f "src/plugins/agent-adapter.test.ts" \
  || { echo "FAIL: T023 — file not found: src/plugins/agent-adapter.test.ts" >&2; exit 1; }

# Assertion 2: Critical test cases (FR-L1-002, 003, 004)
grep -q "dispatch" "src/plugins/agent-adapter.test.ts" \
  || { echo "FAIL: T023 — agent-adapter.test.ts missing 'dispatch' test case (FR-L1-002)" >&2; exit 1; }

grep -q "normaliz" "src/plugins/agent-adapter.test.ts" \
  || { echo "FAIL: T023 — agent-adapter.test.ts missing exit code normalization test (FR-L1-003)" >&2; exit 1; }

# Assertion 3: Run Phase 3 unit tests
pnpm vitest run src/plugins/agent-adapter.test.ts --reporter=verbose \
  || { echo "FAIL: T023 — vitest failed for agent-adapter.test.ts" >&2; exit 1; }

echo "PASS: T023 — Implement test strategy for Phase 3"

#!/bin/bash
# AUTHORED
set -euo pipefail

# Task T014: Implement test strategy for Phase 2
# Description: Implement all unit and integration tests defined in the phase test strategy.

# Assertion 1: Phase 2 unit tests exist
test -f "src/plugins/skill-runtime.test.ts" \
  || { echo "FAIL: T014 — file not found: src/plugins/skill-runtime.test.ts" >&2; exit 1; }

# Assertion 2: Phase 2 integration tests exist
test -f "src/commands/skill.test.ts" \
  || { echo "FAIL: T014 — file not found: src/commands/skill.test.ts" >&2; exit 1; }

# Assertion 3: Run Phase 2 unit tests
pnpm vitest run src/plugins/skill-runtime.test.ts --reporter=verbose \
  || { echo "FAIL: T014 — vitest failed for src/plugins/skill-runtime.test.ts" >&2; exit 1; }

# Assertion 4: Check for critical test cases in skill-runtime.test.ts (TR-004)
grep -q "compound" "src/plugins/skill-runtime.test.ts" \
  || { echo "FAIL: T014 — src/plugins/skill-runtime.test.ts missing test case containing 'compound' (TR-004)" >&2; exit 1; }
grep -q "assembles.*prompt\|prompt.*assembl" "src/plugins/skill-runtime.test.ts" \
  || { echo "FAIL: T014 — src/plugins/skill-runtime.test.ts missing test case for prompt assembly (TR-004)" >&2; exit 1; }

# Assertion 5: Check for critical test cases in skill.test.ts (TR-008)
grep -q "pipe" "src/commands/skill.test.ts" \
  || { echo "FAIL: T014 — src/commands/skill.test.ts missing test case for piping (TR-008)" >&2; exit 1; }

echo "PASS: T014 — Implement test strategy for Phase 2"

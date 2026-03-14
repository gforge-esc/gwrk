#!/bin/bash
set -euo pipefail
# Gate: T017 — Enrich PhaseSchema with optional fields
# Source: plan Phase 3.4
# AUTHORED

# Assertion #1: objective field in PhaseSchema
grep -q 'objective' src/utils/state.ts

# Assertion #2: scope field in PhaseSchema
grep -q 'scope' src/utils/state.ts

# Assertion #3: classification_summary field in PhaseSchema
grep -q 'classification_summary' src/utils/state.ts

# Assertion #4: inputs field in PhaseSchema
grep -q 'inputs' src/utils/state.ts

# Assertion #5: All new fields are optional
grep -q '\.optional()' src/utils/state.ts

# Assertion #6: Existing tests still pass (non-breaking)
pnpm vitest run src/utils/state.test.ts > /dev/null 2>&1 || pnpm vitest run > /dev/null 2>&1 || { echo "FAIL: tests failed"; exit 1; }

# Phase 3 Acceptance Criteria
pnpm test > /dev/null 2>&1 || { echo "FAIL: full test suite failed"; exit 1; }

echo "PASS: T017 — Enrich PhaseSchema with optional fields"

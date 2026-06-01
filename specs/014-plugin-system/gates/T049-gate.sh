#!/bin/bash
set -e

# T049-gate: Verify Review Plugin Layer tests
# Assertion #1: resolveReviewPlugin tests pass
pnpm vitest run src/plugins/review-plugin.test.ts

# Assertion #2: Ship orchestrator integration tests pass
pnpm vitest run src/engine/ship-orchestrator.review.test.ts

echo "✓ T049-gate passed"

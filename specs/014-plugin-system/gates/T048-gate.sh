#!/bin/bash
set -euo pipefail
# AUTHORED

# Phase 8: Review Plugin Layer & Routing Verification
# Target: router, review-plugin, ship-orchestrator

FILES=(
  "src/engine/router.test.ts"
  "src/plugins/review-plugin.test.ts"
  "src/engine/ship-orchestrator.test.ts"
  "src/engine/ship-orchestrator.review.test.ts"
  "src/engine/ship-orchestrator.plan-event.test.ts"
)

for file in "${FILES[@]}"; do
  if [ ! -f "$file" ]; then
    echo "FAIL: T048 — file not found: $file" >&2
    exit 1
  fi
done

pnpm vitest run "${FILES[@]}" --reporter=verbose || {
  echo "FAIL: T048 — vitest failed for Phase 8 test files" >&2
  exit 1
}

echo "PASS: T048 — Phase 8 tests passed (router, review-plugin, ship-orchestrator)"

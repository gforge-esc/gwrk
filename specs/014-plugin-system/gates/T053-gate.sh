#!/bin/bash
# AUTHORED
set -euo pipefail

# T053: Integration test — ship loop dispatches via review plugin
test -f src/plugins/review-plugin.test.ts
test -f src/engine/ship-orchestrator.test.ts

# Run both test files
pnpm vitest run src/plugins/review-plugin.test.ts src/engine/ship-orchestrator.test.ts --reporter=verbose

echo "PASS: T053 — Implement test strategy for Phase 8"

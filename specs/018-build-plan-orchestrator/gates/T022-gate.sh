#!/bin/bash
set -euo pipefail
# Gate: T022 — Implement test strategy for Phase 4

pnpm vitest run src/engine/drift-detector.test.ts src/engine/plan-renderer.test.ts

echo "PASS: T022 — Phase 4 tests pass"

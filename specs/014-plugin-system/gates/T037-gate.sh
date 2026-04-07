#!/bin/bash
# AUTHORED
set -euo pipefail

# Aggregate gate for Phase 6 provisioning & migration
pnpm vitest run src/plugins/migrate.test.ts src/plugins/seed.test.ts src/commands/init.test.ts --reporter=verbose \
  || { echo "FAIL: T037 — vitest failed for Phase 6 tests" >&2; exit 1; }

echo "PASS: T037 — Implement test strategy for Phase 6"

#!/bin/bash
set -euo pipefail
# Gate: T013 — Implement test strategy for Phase 7
# AUTHORED — do not overwrite
# Assertion #1: Verify Phase 7
pnpm vitest run src/server/routes/notify.test.ts --reporter=verbose
echo "PASS: T013"

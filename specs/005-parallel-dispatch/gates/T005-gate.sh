#!/bin/bash
set -euo pipefail
# AUTHORED
# Phase 1 unit and integration tests
pnpm vitest run src/server/sandbox.test.ts
echo "PASS: T005 — Implement test strategy for Phase 1"

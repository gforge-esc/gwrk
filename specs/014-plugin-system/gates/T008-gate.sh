#!/bin/bash
# AUTHORED
set -euo pipefail

# Aggregate gate for Phase 1 foundation
pnpm vitest run src/plugins/loader.test.ts --reporter=verbose

echo "PASS: T008 — Implement test strategy for Phase 1"

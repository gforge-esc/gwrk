#!/bin/bash
# AUTHORED
set -euo pipefail

# Assertion #1: Run harvest engine tests (Phase 4 scope — NOT server-github which includes Phase 5)
pnpm vitest run src/engine/harvest.test.ts

# Assertion #2: Lint clean
pnpm biome check src/engine/harvest.ts

echo "PASS: T012 — notifyDoneDone wired to Slack via mock-safe fallback"

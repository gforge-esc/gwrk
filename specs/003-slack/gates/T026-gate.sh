#!/bin/bash
set -euo pipefail
# Gate: T026 — Implement test strategy for Phase 9
# AUTHORED — do not overwrite
# Assertion #1: Verify full server suite
pnpm vitest run src/server/ --reporter=verbose
echo "PASS: T026"

#!/bin/bash
set -euo pipefail
# Gate: T010 — Implement src/commands/ship.ts
# AUTHORED — do not overwrite
# Assertion #1: Verify ship command
pnpm vitest run src/commands/ship.test.ts --reporter=verbose
echo "PASS: T010"

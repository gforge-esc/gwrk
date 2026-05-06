#!/bin/bash
set -euo pipefail
# Gate: T025 — Implement src/server/routes/notify.ts
# AUTHORED — do not overwrite
# Assertion #1: Verify notify routes
pnpm vitest run src/server/routes/notify.test.ts --reporter=verbose
echo "PASS: T025"

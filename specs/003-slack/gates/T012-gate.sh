#!/bin/bash
set -euo pipefail
# Gate: T012 — Implement src/server/routes/notify.test.ts
# AUTHORED — do not overwrite
# Assertion #1: Verify notify routes
pnpm vitest run src/server/routes/notify.test.ts --reporter=verbose
echo "PASS: T012"

#!/bin/bash
set -euo pipefail
# Gate: T007 — Implement src/server/routes/notify.ts
# AUTHORED — do not overwrite
# Assertion: POST /api/notify returns ok:true
pnpm vitest run src/server/routes/notify.test.ts --reporter=verbose
echo "PASS: T007"

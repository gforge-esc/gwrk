#!/bin/bash
set -euo pipefail
# Gate: T008 — Implement src/server/index.ts
# AUTHORED — do not overwrite
# Assertion #1: Verify server registration
pnpm vitest run src/server/index.test.ts --reporter=verbose
echo "PASS: T008"

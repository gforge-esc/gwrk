#!/bin/bash
set -euo pipefail
# Gate: T021 — Implement src/utils/config.ts
# AUTHORED — do not overwrite
# Assertion #1: Verify config
pnpm vitest run src/utils/config.test.ts --reporter=verbose
echo "PASS: T021"

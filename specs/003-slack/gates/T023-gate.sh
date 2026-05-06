#!/bin/bash
set -euo pipefail
# Gate: T023 — Implement src/commands/init.ts
# AUTHORED — do not overwrite
# Assertion #1: Verify init command
pnpm vitest run src/commands/init.test.ts --reporter=verbose
echo "PASS: T023"

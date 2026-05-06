#!/bin/bash
set -euo pipefail
# Gate: T009 — Implement scripts/dev/agent-run.sh
# AUTHORED — do not overwrite
# Assertion #1: Verify integration
pnpm vitest run src/server/integration.test.ts --reporter=verbose
echo "PASS: T009"

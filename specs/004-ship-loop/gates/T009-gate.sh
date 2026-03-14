#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
pnpm vitest run src/scripts-e2e.test.ts 2>&1 | grep -qE 'Tests.*pass' || { echo "FAIL: scripts-e2e.test.ts failures"; exit 1; }
echo "PASS: T009 — resilience E2E tests passing"

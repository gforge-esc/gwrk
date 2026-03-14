#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
pnpm vitest run src/commands/ship.test.ts 2>&1 | grep -qE 'Tests.*pass' || { echo "FAIL: ship.test.ts failures"; exit 1; }
echo "PASS: T005 — phase-skip and digest tests passing"

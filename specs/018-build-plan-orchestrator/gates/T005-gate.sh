#!/bin/bash
set -euo pipefail
# Gate: T005 — Implement src/commands/plan.ts

test -f src/commands/plan.ts
# Verify empty-graph guard
pnpm tsx src/cli.ts plan status 2>&1 | grep -q "No build plan data"

echo "PASS: T005 — CLI entry point with guards implemented"

#!/bin/bash
set -euo pipefail
# Gate: T010 — Implement src/commands/plan.ts (subcommands)

pnpm tsx src/cli.ts plan --help | grep -q "next"
pnpm tsx src/cli.ts plan --help | grep -q "critical"
pnpm tsx src/cli.ts plan --help | grep -q "waves"

echo "PASS: T010 — Solver subcommands added"

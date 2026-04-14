#!/bin/bash
set -euo pipefail
# Gate: T013 — Implement src/commands/plan.ts (mutation)

pnpm tsx src/cli.ts plan --help | grep -q "add"
pnpm tsx src/cli.ts plan --help | grep -q "remove"
pnpm tsx src/cli.ts plan --help | grep -q "dep"
pnpm tsx src/cli.ts plan --help | grep -q "set"

echo "PASS: T013 — Mutation subcommands added"

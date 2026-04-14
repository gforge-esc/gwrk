#!/bin/bash
set -euo pipefail
# Gate: T025 — Implement src/commands/plan.ts (viz, review)

pnpm tsx src/cli.ts plan --help | grep -q "viz"
pnpm tsx src/cli.ts plan --help | grep -q "review"

echo "PASS: T025 — Monitoring subcommands added"

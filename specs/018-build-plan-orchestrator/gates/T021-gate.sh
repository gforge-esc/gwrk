#!/bin/bash
set -euo pipefail
# Gate: T021 — Implement src/commands/plan.ts (verify, render)

pnpm tsx src/cli.ts plan --help | grep -q "verify"
pnpm tsx src/cli.ts plan --help | grep -q "render"

echo "PASS: T021 — Verification and rendering subcommands added"

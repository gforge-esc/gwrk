#!/bin/bash
set -euo pipefail
# Gate: T007 — Implement src/cli.ts (wire plan command)

pnpm tsx src/cli.ts --help | grep -q "plan"

echo "PASS: T007 — Command wired to CLI"

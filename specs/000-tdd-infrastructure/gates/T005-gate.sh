#!/bin/bash
# AUTHORED
set -euo pipefail
# Gate: T005 — Implement src/cli.ts
test -f src/cli.ts
grep -q "testCommand" src/cli.ts
echo "PASS: T005 — Implement src/cli.ts"

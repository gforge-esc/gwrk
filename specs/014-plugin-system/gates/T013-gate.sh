#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/commands/skill.test.ts
pnpm vitest run src/commands/skill.test.ts --reporter=verbose

echo "PASS: T013 — Implement src/commands/skill.test.ts"

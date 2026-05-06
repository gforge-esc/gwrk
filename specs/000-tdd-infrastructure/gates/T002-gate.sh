#!/bin/bash
# AUTHORED
set -euo pipefail
# Gate: T002 — Implement src/commands/tasks-generate.ts
test -f src/commands/tasks-generate.ts
grep -q "contracts/" src/commands/tasks-generate.ts
grep -q "Contracts required for gate authoring" src/commands/tasks-generate.ts
grep -q "dispatchAgent" src/commands/tasks-generate.ts
grep -q "no-llm" src/commands/tasks-generate.ts
pnpm vitest run src/commands/tasks-generate.test.ts --reporter=verbose
echo "PASS: T002 — Implement src/commands/tasks-generate.ts"

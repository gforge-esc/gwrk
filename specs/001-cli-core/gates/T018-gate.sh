#!/bin/bash
set -euo pipefail
# Gate: T018 — gwrk tasks command with generate and done subcommands

test -f src/commands/tasks.ts
grep -q 'generate' src/commands/tasks.ts
grep -q 'done' src/commands/tasks.ts
grep -q 'parsePlan\|parser' src/commands/tasks.ts
grep -q 'saveTaskState\|state' src/commands/tasks.ts
grep -q 'generateGates\|gate-gen\|gateGen' src/commands/tasks.ts
grep -q 'runGate' src/commands/tasks.ts
grep -q 'markTaskComplete' src/commands/tasks.ts
grep -q 'appendHistory\|history' src/commands/tasks.ts

echo "PASS: T018 — tasks.ts has generate and done with gate enforcement"

#!/bin/bash
set -euo pipefail
# Gate: T014 — Zod schemas and state management in src/utils/state.ts

test -f src/utils/state.ts
grep -q 'TaskStateSchema' src/utils/state.ts
grep -q 'PhaseSchema' src/utils/state.ts
grep -q 'TaskSchema' src/utils/state.ts
grep -q 'loadTaskState' src/utils/state.ts
grep -q 'saveTaskState' src/utils/state.ts
grep -q 'markTaskComplete' src/utils/state.ts
grep -q "z\.object\|z\.array\|z\.string" src/utils/state.ts
grep -q "process\.exit(1)" src/utils/state.ts

echo "PASS: T014 — state.ts has all Zod schemas and state management functions"

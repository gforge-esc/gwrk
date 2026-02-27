#!/bin/bash
set -euo pipefail
# Gate: T020 — list and next subcommands in tasks.ts

grep -q 'list' src/commands/tasks.ts
grep -q 'next' src/commands/tasks.ts
grep -q 'listTasks\|list.*tasks' src/commands/tasks.ts
grep -q 'nextTask\|next.*task' src/commands/tasks.ts
grep -q '\-\-json\|json' src/commands/tasks.ts

echo "PASS: T020 — tasks.ts has list and next with --json output"

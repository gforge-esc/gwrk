#!/bin/bash
set -euo pipefail
# Gate: T010 — gwrk specify command

test -f src/commands/specify.ts
grep -q 'specify' src/commands/specify.ts
grep -q 'dispatchAgent\|agent' src/commands/specify.ts
grep -q 'specify.md\|/specify' src/commands/specify.ts

echo "PASS: T010 — specify.ts dispatches agent with /specify workflow"

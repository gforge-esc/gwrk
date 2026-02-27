#!/bin/bash
set -euo pipefail
# Gate: T012 — gwrk analyze and effort commands

test -f src/commands/analyze.ts
test -f src/commands/effort.ts
grep -q 'analyze' src/commands/analyze.ts
grep -q 'effort' src/commands/effort.ts
grep -q 'dispatchAgent\|agent' src/commands/analyze.ts
grep -q 'dispatchAgent\|agent' src/commands/effort.ts

echo "PASS: T012 — analyze.ts and effort.ts dispatch agents"

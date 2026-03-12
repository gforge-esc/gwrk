#!/bin/bash
set -euo pipefail
# Gate: T024 — Implement src/server/slack-commands.ts
# Asserts: Derived from task description

test -f src/server/slack-commands.ts
# Required identifiers
grep -q 'tasks' src/server/slack-commands.ts
grep -q 'runs' src/server/slack-commands.ts

echo "PASS: T024 — Implement src/server/slack-commands.ts"

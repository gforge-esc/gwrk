#!/bin/bash
set -euo pipefail
# Gate: T015 — Implement src/server/slack-actions.ts
# Asserts: Derived from task description

test -f src/server/slack-actions.ts
# Required identifiers
grep -q 'merge_pr' src/server/slack-actions.ts
grep -q 'runs' src/server/slack-actions.ts
grep -q 'pr_number' src/server/slack-actions.ts

echo "PASS: T015 — Implement src/server/slack-actions.ts"

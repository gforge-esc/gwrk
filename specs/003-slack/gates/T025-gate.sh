#!/bin/bash
set -euo pipefail
# Gate: T025 — Implement src/server/slack-messages.ts
# Asserts: Derived from task description

test -f src/server/slack-messages.ts
grep -q 'batchedSummary' src/server/slack-messages.ts

echo "PASS: T025 — Implement src/server/slack-messages.ts"

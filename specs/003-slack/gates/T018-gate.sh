#!/bin/bash
set -euo pipefail
# Gate: T018 — Implement src/server/slack-commands.ts
# Asserts: Derived from task description

test -f src/server/slack-commands.ts
# Required identifiers
grep -q 'getPrForPhase' src/server/slack-commands.ts

echo "PASS: T018 — Implement src/server/slack-commands.ts"

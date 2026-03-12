#!/bin/bash
set -euo pipefail
# Gate: T017 — Implement src/server/slack.ts
# Asserts: Derived from task description

test -f src/server/slack.ts
# Required identifiers
grep -q 'CommandContext' src/server/slack.ts

echo "PASS: T017 — Implement src/server/slack.ts"

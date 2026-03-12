#!/bin/bash
set -euo pipefail
# Gate: T022 — Implement src/server/slack-notify.ts
# Asserts: Derived from task description

test -f src/server/slack-notify.ts
# Required identifiers
grep -q 'channelId' src/server/slack-notify.ts
grep -q 'opsChannelId' src/server/slack-notify.ts

echo "PASS: T022 — Implement src/server/slack-notify.ts"

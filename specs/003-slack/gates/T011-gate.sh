#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/server/slack-notify.ts \
  || { echo "FAIL: T011 — file not found: src/server/slack-notify.ts" >&2; exit 1; }
grep -q 'opsChannelId' src/server/slack-notify.ts \
  || { echo "FAIL: T011 — src/server/slack-notify.ts missing 'opsChannelId'" >&2; exit 1; }
grep -q 'notifySlack' src/server/slack-notify.ts \
  || { echo "FAIL: T011 — src/server/slack-notify.ts missing 'notifySlack'" >&2; exit 1; }

echo "PASS: T011 — Implement src/server/slack-notify.ts"

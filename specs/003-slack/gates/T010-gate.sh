#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/utils/slack-webhook.ts \
  || { echo "FAIL: T010 — file not found: src/utils/slack-webhook.ts" >&2; exit 1; }
grep -q 'sendSlackWebhook' src/utils/slack-webhook.ts \
  || { echo "FAIL: T010 — src/utils/slack-webhook.ts missing 'sendSlackWebhook'" >&2; exit 1; }

echo "PASS: T010 — Implement src/utils/slack-webhook.ts"

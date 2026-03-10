#!/bin/bash
set -e
echo "Gate T013: Notification dispatcher"
# Assertion #1: File exists
test -f src/server/slack-notify.ts || { echo "FAIL: src/server/slack-notify.ts not found"; exit 1; }
# Assertion #2: SlackEvent type
grep -q "SlackEvent" src/server/slack-notify.ts || { echo "FAIL: No SlackEvent type"; exit 1; }
# Assertion #3: SlackMessage type
grep -q "SlackMessage" src/server/slack-notify.ts || { echo "FAIL: No SlackMessage type"; exit 1; }
# Assertion #4: postMessage or chat
grep -q "postMessage\|chat\|post" src/server/slack-notify.ts || { echo "FAIL: No message posting logic"; exit 1; }
echo "PASS"

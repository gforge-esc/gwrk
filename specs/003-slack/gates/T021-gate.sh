#!/bin/bash
set -e
echo "Gate T021: Presence poller and notification queue"
# Assertion #1: File exists
test -f src/server/slack-presence.ts || { echo "FAIL: src/server/slack-presence.ts not found"; exit 1; }
# Assertion #2: Presence detection
grep -q "getPresence\|presence\|Presence" src/server/slack-presence.ts || { echo "FAIL: No presence detection logic"; exit 1; }
# Assertion #3: Batch queue
grep -q "batch\|Batch\|queue\|Queue" src/server/slack-presence.ts || { echo "FAIL: No batch queue logic"; exit 1; }
# Assertion #4: 100 event cap
grep -q "100\|maxBatch\|cap\|truncat" src/server/slack-presence.ts || { echo "FAIL: No batch event cap"; exit 1; }
echo "PASS"

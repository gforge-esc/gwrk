#!/bin/bash
set -e
echo "Gate T022: Wire presence gate into notification dispatcher"
# Assertion #1: Presence import in notify
grep -q "presence\|Presence" src/server/slack-notify.ts || { echo "FAIL: No presence gate in slack-notify.ts"; exit 1; }
# Assertion #2: batchedSummary in messages
grep -q "batchedSummary\|batched" src/server/slack-messages.ts || { echo "FAIL: No batchedSummary in slack-messages.ts"; exit 1; }
echo "PASS"

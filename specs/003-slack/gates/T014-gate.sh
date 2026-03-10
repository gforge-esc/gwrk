#!/bin/bash
set -e
echo "Gate T014: Add notification hooks to ship and dispatch"
# Assertion #1: Slack import in ship.ts
grep -q "slack\|notify\|Slack" src/commands/ship.ts || { echo "FAIL: No Slack notification in ship.ts"; exit 1; }
# Assertion #2: Event emission in dispatch.ts
grep -q "emit\|event\|notify\|slack" src/server/dispatch.ts || { echo "FAIL: No event emission in dispatch.ts"; exit 1; }
echo "PASS"

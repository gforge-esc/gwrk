#!/bin/bash
set -e
echo "Gate T007: Bolt App instance with server lifecycle"
# Assertion #1: File exists
test -f src/server/slack.ts || { echo "FAIL: src/server/slack.ts not found"; exit 1; }
# Assertion #2: Bolt App import
grep -q "@slack/bolt\|from.*bolt" src/server/slack.ts || { echo "FAIL: No Bolt SDK import"; exit 1; }
# Assertion #3: Socket Mode enabled
grep -q "socketMode\|socket.*mode" src/server/slack.ts || { echo "FAIL: No Socket Mode config"; exit 1; }
# Assertion #4: Lifecycle methods
grep -q "start\|stop" src/server/slack.ts || { echo "FAIL: No start/stop lifecycle"; exit 1; }
echo "PASS"

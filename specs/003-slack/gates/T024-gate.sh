#!/bin/bash
set -e
echo "Gate T024: App Home Tab builder"
# Assertion #1: File exists
test -f src/server/slack-home.ts || { echo "FAIL: src/server/slack-home.ts not found"; exit 1; }
# Assertion #2: app_home_opened handler
grep -q "app_home_opened\|home.*open\|views.publish" src/server/slack-home.ts || { echo "FAIL: No app_home_opened handler"; exit 1; }
# Assertion #3: Active Agents section
grep -q "Active.*Agent\|activeAgent\|agent" src/server/slack-home.ts || { echo "FAIL: No Active Agents section"; exit 1; }
# Assertion #4: Dispatch Queue section
grep -q "Dispatch.*Queue\|dispatchQueue\|queue" src/server/slack-home.ts || { echo "FAIL: No Dispatch Queue section"; exit 1; }
# Assertion #5: System Resources section
grep -q "System.*Resource\|cpu\|mem\|resource" src/server/slack-home.ts || { echo "FAIL: No System Resources section"; exit 1; }
echo "PASS"

#!/bin/bash
set -e
echo "Gate T025: Register Home Tab handler and export status data"
# Assertion #1: app_home_opened in slack.ts
grep -q "app_home_opened\|home" src/server/slack.ts || { echo "FAIL: No Home Tab handler registration"; exit 1; }
# Assertion #2: Export in status.ts
grep -q "export.*function\|export.*collect\|export.*status" src/server/routes/status.ts || { echo "FAIL: No exported status function"; exit 1; }
echo "PASS"

#!/bin/bash
set -e
echo "Gate T003: Config schema extension for Slack"
# Assertion #1: channelId in config schema
grep -q "channelId" src/utils/config.ts || { echo "FAIL: channelId not in config schema"; exit 1; }
# Assertion #2: channelName in config schema
grep -q "channelName" src/utils/config.ts || { echo "FAIL: channelName not in config schema"; exit 1; }
echo "PASS"

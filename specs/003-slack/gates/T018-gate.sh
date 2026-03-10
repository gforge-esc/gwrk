#!/bin/bash
set -e
echo "Gate T018: Register handlers with Bolt and health check"
# Assertion #1: Command registration in slack.ts
grep -q "command\|slash\|handler" src/server/slack.ts || { echo "FAIL: No command registration in slack.ts"; exit 1; }
# Assertion #2: Slack in health endpoint
grep -q "slack\|Slack\|isConnected" src/server/routes/health.ts || { echo "FAIL: No Slack status in health endpoint"; exit 1; }
echo "PASS"

#!/bin/bash
set -e
echo "Gate T010: Wire channel creation into gwrk init"
# Assertion #1: Slack channel logic in init.ts
grep -q "slack.*channel\|createChannel\|createOrReuse\|slack-channel" src/commands/init.ts || { echo "FAIL: No Slack channel creation in init.ts"; exit 1; }
echo "PASS"

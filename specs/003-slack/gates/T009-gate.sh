#!/bin/bash
set -e
echo "Gate T009: Channel-per-project logic"
# Assertion #1: File exists
test -f src/server/slack-channel.ts || { echo "FAIL: src/server/slack-channel.ts not found"; exit 1; }
# Assertion #2: conversations.create
grep -q "conversations.create\|channels\|createChannel\|createOrReuse" src/server/slack-channel.ts || { echo "FAIL: No channel creation logic"; exit 1; }
# Assertion #3: Config update
grep -q "channelId\|channelName" src/server/slack-channel.ts || { echo "FAIL: No config update with channelId/channelName"; exit 1; }
echo "PASS"

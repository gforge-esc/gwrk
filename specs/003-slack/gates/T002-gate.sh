#!/bin/bash
set -e
echo "Gate T002: Slack token loader and client wrapper"
# Assertion #1: File exists
test -f src/utils/slack-client.ts || { echo "FAIL: src/utils/slack-client.ts not found"; exit 1; }
# Assertion #2: Exports SlackSetupResult
grep -q "SlackSetupResult" src/utils/slack-client.ts || { echo "FAIL: SlackSetupResult type not exported"; exit 1; }
# Assertion #3: Loads from .env
grep -q "SLACK_BOT_TOKEN\|dotenv\|\.env" src/utils/slack-client.ts || { echo "FAIL: No token loading logic"; exit 1; }
# Assertion #4: Fail-fast on missing tokens
grep -q "process.exit(1)\|throw" src/utils/slack-client.ts || { echo "FAIL: No fail-fast on missing tokens"; exit 1; }
echo "PASS"

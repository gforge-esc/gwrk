#!/bin/bash
set -e
echo "Gate T004: gwrk setup slack command"
# Assertion #1: File exists
test -f src/commands/setup-slack.ts || { echo "FAIL: src/commands/setup-slack.ts not found"; exit 1; }
# Assertion #2: setupSlack function
grep -q "setupSlack\|setup.*slack\|async.*function" src/commands/setup-slack.ts || { echo "FAIL: No setupSlack function"; exit 1; }
# Assertion #3: --verify handling
grep -q "verify" src/commands/setup-slack.ts || { echo "FAIL: No --verify flag handling"; exit 1; }
# Assertion #4: Idempotency check
grep -q "already.*configured\|idempotent\|existing" src/commands/setup-slack.ts || { echo "FAIL: No idempotency logic"; exit 1; }
echo "PASS"

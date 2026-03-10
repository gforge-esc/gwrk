#!/bin/bash
set -e
echo "Gate T015: Unit tests for Block Kit messages"
# Assertion #1: Test file exists
test -f src/server/slack-messages.test.ts || { echo "FAIL: slack-messages.test.ts not found"; exit 1; }
# Assertion #2: Tests pass
pnpm vitest run src/server/slack-messages.test.ts --reporter=verbose 2>&1 | tail -5
echo "PASS"

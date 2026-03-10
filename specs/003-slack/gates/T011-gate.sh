#!/bin/bash
set -e
echo "Gate T011: Unit tests for channel management"
# Assertion #1: Test file exists
test -f src/server/slack-channel.test.ts || { echo "FAIL: slack-channel.test.ts not found"; exit 1; }
# Assertion #2: Tests pass
pnpm vitest run src/server/slack-channel.test.ts --reporter=verbose 2>&1 | tail -5
echo "PASS"

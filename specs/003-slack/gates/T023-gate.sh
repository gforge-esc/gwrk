#!/bin/bash
set -e
echo "Gate T023: Unit tests for presence throttling"
# Assertion #1: Test file exists
test -f src/server/slack-presence.test.ts || { echo "FAIL: slack-presence.test.ts not found"; exit 1; }
# Assertion #2: Tests pass
pnpm vitest run src/server/slack-presence.test.ts --reporter=verbose 2>&1 | tail -5
echo "PASS"

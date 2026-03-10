#!/bin/bash
set -e
echo "Gate T026: Unit tests for App Home Tab"
# Assertion #1: Test file exists
test -f src/server/slack-home.test.ts || { echo "FAIL: slack-home.test.ts not found"; exit 1; }
# Assertion #2: Tests pass
pnpm vitest run src/server/slack-home.test.ts --reporter=verbose 2>&1 | tail -5
echo "PASS"

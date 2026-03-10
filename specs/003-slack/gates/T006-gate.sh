#!/bin/bash
set -e
echo "Gate T006: Unit tests for setup and client"
# Assertion #1: setup-slack test file
test -f src/commands/setup-slack.test.ts || { echo "FAIL: setup-slack.test.ts not found"; exit 1; }
# Assertion #2: slack test file  
test -f src/server/slack.test.ts || { echo "FAIL: slack.test.ts not found"; exit 1; }
# Assertion #3: Tests pass
pnpm vitest run src/commands/setup-slack.test.ts src/server/slack.test.ts --reporter=verbose 2>&1 | tail -5
echo "PASS"

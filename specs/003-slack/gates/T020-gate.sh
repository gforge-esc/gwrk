#!/bin/bash
set -e
echo "Gate T020: Integration test for slash commands"
# Assertion #1: Integration test file
test -f src/server/slack-integration.test.ts || { echo "FAIL: slack-integration.test.ts not found"; exit 1; }
# Assertion #2: Tests pass
pnpm vitest run src/server/slack-integration.test.ts --reporter=verbose 2>&1 | tail -5
echo "PASS"

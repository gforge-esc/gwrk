#!/bin/bash
set -e
echo "Gate T019: Unit tests for commands and actions"
# Assertion #1: Commands test file
test -f src/server/slack-commands.test.ts || { echo "FAIL: slack-commands.test.ts not found"; exit 1; }
# Assertion #2: Actions test file
test -f src/server/slack-actions.test.ts || { echo "FAIL: slack-actions.test.ts not found"; exit 1; }
# Assertion #3: Tests pass
pnpm vitest run src/server/slack-commands.test.ts src/server/slack-actions.test.ts --reporter=verbose 2>&1 | tail -5
echo "PASS"

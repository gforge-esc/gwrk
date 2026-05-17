#!/bin/bash
set -euo pipefail
# Gate: T005 — Implement test strategy for Phase 1

echo "▸ Running Phase 1 Slack Tests..."
npx vitest run src/server/slack-commands.test.ts src/server/slack-messages.test.ts src/server/slack-actions.test.ts \
  || { echo "FAIL: T005 — Phase 1 tests failed" >&2; exit 1; }

echo "PASS: T005 — Phase 1 test strategy verified"

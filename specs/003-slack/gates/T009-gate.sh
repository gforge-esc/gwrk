#!/bin/bash
set -euo pipefail
# Gate: T009 — Implement test strategy for Phase 2

echo "▸ Running Phase 2 Slack Tests..."
npx vitest run src/server/slack-agent.test.ts src/utils/agent-context.test.ts \
  || { echo "FAIL: T009 — Phase 2 tests failed" >&2; exit 1; }

echo "PASS: T009 — Phase 2 test strategy verified"

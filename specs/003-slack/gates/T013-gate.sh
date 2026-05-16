#!/bin/bash
set -euo pipefail
# Gate: T013 — Implement test strategy for Phase 3

echo "▸ Running Phase 3 Slack Tests..."
npx vitest run src/utils/slack-webhook.test.ts src/server/slack-notify.test.ts \
  || { echo "FAIL: T013 — Phase 3 tests failed" >&2; exit 1; }

echo "PASS: T013 — Phase 3 test strategy verified"

#!/bin/bash
# AUTHORED
set -euo pipefail
test -f src/server/slack-notify.test.ts || { echo "FAIL: T019 — file not found: src/server/slack-notify.test.ts" >&2; exit 1; }
pnpm vitest run src/server/slack-notify.test.ts --reporter=verbose || { echo "FAIL: T019 — vitest failed for src/server/slack-notify.test.ts" >&2; exit 1; }
echo "PASS: T019 — Implement src/server/slack-notify.test.ts"

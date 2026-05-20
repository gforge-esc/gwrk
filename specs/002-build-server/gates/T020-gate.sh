#!/bin/bash
# AUTHORED
set -euo pipefail
test -f src/server/slack-actions.test.ts || { echo "FAIL: T020 — file not found: src/server/slack-actions.test.ts" >&2; exit 1; }
pnpm vitest run src/server/slack-actions.test.ts --reporter=verbose || { echo "FAIL: T020 — vitest failed for src/server/slack-actions.test.ts" >&2; exit 1; }
echo "PASS: T020 — Implement src/server/slack-actions.test.ts"

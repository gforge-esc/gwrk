#!/bin/bash
# AUTHORED
set -euo pipefail
test -f src/commands/server.test.ts || { echo "FAIL: T009 — missing src/commands/server.test.ts" >&2; exit 1; }
test -f src/commands/server-install.test.ts || { echo "FAIL: T009 — missing src/commands/server-install.test.ts" >&2; exit 1; }
test -f src/server/routes/health.test.ts || { echo "FAIL: T009 — missing src/server/routes/health.test.ts" >&2; exit 1; }
echo "PASS: T009 — Implement test strategy for Phase 1"
#!/usr/bin/env bash
set -euo pipefail
# AUTHORED against the approved production authentication contract.
# Missing tests deny completion before the behavioral commands run.
if [[ ! -f src/server/auth-prehandler.test.ts ]]; then
  echo 'FAIL: required behavioral test is missing: src/server/auth-prehandler.test.ts' >&2
  exit 1
fi
if [[ ! -f src/server/auth-session.test.ts ]]; then
  echo 'FAIL: required behavioral test is missing: src/server/auth-session.test.ts' >&2
  exit 1
fi
if [[ ! -f src/server/auth-api-keys.test.ts ]]; then
  echo 'FAIL: required behavioral test is missing: src/server/auth-api-keys.test.ts' >&2
  exit 1
fi
pnpm run build
pnpm exec vitest run src/server/auth-prehandler.test.ts src/server/auth-session.test.ts src/server/auth-api-keys.test.ts src/server/routes/status.test.ts src/server/routes/dispatch.test.ts src/server/routes/notify.test.ts src/server/routes/health.test.ts src/architecture.test.ts

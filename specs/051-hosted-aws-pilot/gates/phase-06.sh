#!/usr/bin/env bash
set -euo pipefail
# AUTHORED against the approved production authentication contract.
# Missing tests deny completion before the behavioral commands run.
if [[ ! -f src/adapters/auth/http-client-credential.test.ts ]]; then
  echo 'FAIL: required behavioral test is missing: src/adapters/auth/http-client-credential.test.ts' >&2
  exit 1
fi
if [[ ! -f src/commands/server.auth-startup.test.ts ]]; then
  echo 'FAIL: required behavioral test is missing: src/commands/server.auth-startup.test.ts' >&2
  exit 1
fi
if [[ ! -f src/server/auth-continuity.test.ts ]]; then
  echo 'FAIL: required behavioral test is missing: src/server/auth-continuity.test.ts' >&2
  exit 1
fi
if [[ ! -f src/commands/init.test.ts ]]; then
  echo 'FAIL: required behavioral test is missing: src/commands/init.test.ts' >&2
  exit 1
fi
pnpm run build
pnpm exec vitest run src/adapters/auth/http-client-credential.test.ts src/commands/server.auth-startup.test.ts src/server/auth-continuity.test.ts src/commands/init.test.ts src/commands/server.test.ts src/commands/status.test.ts src/architecture.test.ts

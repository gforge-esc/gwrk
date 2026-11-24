#!/usr/bin/env bash
set -euo pipefail
# AUTHORED against the approved production authentication contract.
# Missing tests deny completion before the behavioral commands run.
if [[ ! -f src/adapters/auth/google-id-token.test.ts ]]; then
  echo 'FAIL: required behavioral test is missing: src/adapters/auth/google-id-token.test.ts' >&2
  exit 1
fi
if [[ ! -f src/application/auth/authenticate-request.test.ts ]]; then
  echo 'FAIL: required behavioral test is missing: src/application/auth/authenticate-request.test.ts' >&2
  exit 1
fi
pnpm run build
pnpm exec vitest run src/adapters/auth/google-id-token.test.ts src/application/auth/authenticate-request.test.ts src/architecture.test.ts

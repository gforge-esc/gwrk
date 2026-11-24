#!/usr/bin/env bash
set -euo pipefail
# AUTHORED against the approved production authentication contract.
# Missing tests deny completion before the behavioral commands run.
if [[ ! -f src/adapters/sqlite/auth-store.test.ts ]]; then
  echo 'FAIL: required behavioral test is missing: src/adapters/sqlite/auth-store.test.ts' >&2
  exit 1
fi
if [[ ! -f src/commands/auth.test.ts ]]; then
  echo 'FAIL: required behavioral test is missing: src/commands/auth.test.ts' >&2
  exit 1
fi
if [[ ! -f src/adapters/auth/credential-crypto.test.ts ]]; then
  echo 'FAIL: required behavioral test is missing: src/adapters/auth/credential-crypto.test.ts' >&2
  exit 1
fi
pnpm run build
pnpm exec vitest run src/adapters/auth/credential-crypto.test.ts src/adapters/sqlite/auth-store.test.ts src/commands/auth.test.ts src/db/db.test.ts src/architecture.test.ts

#!/usr/bin/env bash
set -euo pipefail
# AUTHORED against the approved production authentication contract.
# Missing tests deny completion before the behavioral commands run.
if [[ ! -f src/architecture.test.ts ]]; then
  echo 'FAIL: required behavioral test is missing: src/architecture.test.ts' >&2
  exit 1
fi
if [[ ! -f src/domain/auth-policy.test.ts ]]; then
  echo 'FAIL: required behavioral test is missing: src/domain/auth-policy.test.ts' >&2
  exit 1
fi
pnpm run build
pnpm exec vitest run src/domain/auth-policy.test.ts src/architecture.test.ts
node dist/cli.js define adr --reindex --check
node dist/cli.js define adr --check

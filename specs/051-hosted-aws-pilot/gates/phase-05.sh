#!/usr/bin/env bash
set -euo pipefail
# AUTHORED against the approved production authentication contract.
# Missing tests deny completion before the behavioral commands run.
if [[ ! -f src/server/auth-csrf.test.ts ]]; then
  echo 'FAIL: required behavioral test is missing: src/server/auth-csrf.test.ts' >&2
  exit 1
fi
if [[ ! -f src/server/routes/health.auth.test.ts ]]; then
  echo 'FAIL: required behavioral test is missing: src/server/routes/health.auth.test.ts' >&2
  exit 1
fi
if [[ ! -f src/server/github.test.ts ]]; then
  echo 'FAIL: required behavioral test is missing: src/server/github.test.ts' >&2
  exit 1
fi
if [[ ! -f src/server/auth-bounds.test.ts ]]; then
  echo 'FAIL: required behavioral test is missing: src/server/auth-bounds.test.ts' >&2
  exit 1
fi
if [[ ! -f src/server/auth-logging.test.ts ]]; then
  echo 'FAIL: required behavioral test is missing: src/server/auth-logging.test.ts' >&2
  exit 1
fi
if [[ ! -f src/server/auth-route-policy.test.ts ]]; then
  echo 'FAIL: required behavioral test is missing: src/server/auth-route-policy.test.ts' >&2
  exit 1
fi
pnpm run build
pnpm exec vitest run src/server/auth-csrf.test.ts src/server/routes/health.auth.test.ts src/server/auth-route-policy.test.ts src/server/auth-bounds.test.ts src/server/auth-logging.test.ts src/server/github.test.ts src/architecture.test.ts

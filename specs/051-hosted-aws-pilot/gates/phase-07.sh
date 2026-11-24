#!/usr/bin/env bash
set -euo pipefail
# AUTHORED against the approved production authentication contract.
# Missing tests deny completion before the behavioral commands run.
if [[ ! -f tests/hosted-pilot/gateway-production.mjs ]]; then
  echo 'FAIL: required behavioral test is missing: tests/hosted-pilot/gateway-production.mjs' >&2
  exit 1
fi
if [[ ! -f tests/linux-runner/preflight-auth.test.ts ]]; then
  echo 'FAIL: required behavioral test is missing: tests/linux-runner/preflight-auth.test.ts' >&2
  exit 1
fi
if [[ ! -f tests/hosted-auth-proof/gateway-proof.mjs ]]; then
  echo 'FAIL: required behavioral test is missing: tests/hosted-auth-proof/gateway-proof.mjs' >&2
  exit 1
fi
pnpm run build
pnpm exec vitest run tests/linux-runner/preflight-auth.test.ts tests/hosted-auth-proof/preflight.test.ts tests/hosted-auth-proof/production-bundle.test.ts
node tests/hosted-pilot/gateway-production.mjs
node tests/hosted-auth-proof/gateway-proof.mjs

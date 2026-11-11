#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T001 — Create preflight.sh
# Generated from filesystem convention (deterministic test gate)

test -f tests/hosted-auth-proof/preflight.test.ts || { echo "FAIL: T001 — file not found: tests/hosted-auth-proof/preflight.test.ts" >&2; exit 1; }

pnpm vitest run tests/hosted-auth-proof/preflight.test.ts --reporter=verbose \
  || { echo "FAIL: T001 — test failed for tests/hosted-auth-proof/preflight.test.ts" >&2; exit 1; }

echo "PASS: T001 — Create preflight.sh"

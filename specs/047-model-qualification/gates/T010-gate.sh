#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T010 — Create smoke-probe.ts
# Generated from filesystem convention (deterministic test gate)

test -f src/adapters/models/smoke-probe.ts || { echo "FAIL: T010 — file not found: src/adapters/models/smoke-probe.ts" >&2; exit 1; }

pnpm vitest run src/adapters/models/smoke-probe.test.ts --reporter=verbose \
  || { echo "FAIL: T010 — test failed for src/adapters/models/smoke-probe.test.ts" >&2; exit 1; }

echo "PASS: T010 — Create smoke-probe.ts"

#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T006 — Modify toolchain.ts
# Generated from filesystem convention (deterministic test gate)

test -f src/domain/toolchain.ts || { echo "FAIL: T006 — file not found: src/domain/toolchain.ts" >&2; exit 1; }

pnpm vitest run src/domain/toolchain.test.ts --reporter=verbose \
  || { echo "FAIL: T006 — test failed for src/domain/toolchain.test.ts" >&2; exit 1; }

echo "PASS: T006 — Modify toolchain.ts"

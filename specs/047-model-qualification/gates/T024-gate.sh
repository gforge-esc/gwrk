#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T024 — Modify manifest.ts
# Generated from filesystem convention (deterministic test gate)

test -f src/utils/manifest.ts || { echo "FAIL: T024 — file not found: src/utils/manifest.ts" >&2; exit 1; }

pnpm vitest run src/utils/manifest.test.ts --reporter=verbose \
  || { echo "FAIL: T024 — test failed for src/utils/manifest.test.ts" >&2; exit 1; }

echo "PASS: T024 — Modify manifest.ts"

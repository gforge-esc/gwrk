#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T009 — Modify skill-runtime.ts
# Generated from filesystem convention (deterministic test gate)

test -f src/plugins/skill-runtime.ts || { echo "FAIL: T009 — file not found: src/plugins/skill-runtime.ts" >&2; exit 1; }

pnpm vitest run src/plugins/skill-runtime.test.ts --reporter=verbose \
  || { echo "FAIL: T009 — test failed for src/plugins/skill-runtime.test.ts" >&2; exit 1; }

echo "PASS: T009 — Modify skill-runtime.ts"

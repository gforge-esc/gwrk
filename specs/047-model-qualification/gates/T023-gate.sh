#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T023 — Modify workflow-runtime.ts
# Generated from filesystem convention (deterministic test gate)

test -f src/plugins/workflow-runtime.ts || { echo "FAIL: T023 — file not found: src/plugins/workflow-runtime.ts" >&2; exit 1; }

pnpm vitest run src/plugins/workflow-runtime.test.ts --reporter=verbose \
  || { echo "FAIL: T023 — test failed for src/plugins/workflow-runtime.test.ts" >&2; exit 1; }

echo "PASS: T023 — Modify workflow-runtime.ts"

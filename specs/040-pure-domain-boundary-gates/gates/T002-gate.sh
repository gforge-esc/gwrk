#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T002 — Modify project-id.ts
# Generated from filesystem convention (deterministic test gate)

test -f src/domain/project-id.ts || { echo "FAIL: T002 — file not found: src/domain/project-id.ts" >&2; exit 1; }

pnpm vitest run src/domain/project-id.test.ts --reporter=verbose \
  || { echo "FAIL: T002 — test failed for src/domain/project-id.test.ts" >&2; exit 1; }

echo "PASS: T002 — Modify project-id.ts"

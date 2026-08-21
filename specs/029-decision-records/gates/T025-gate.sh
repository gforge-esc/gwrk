#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T025 — Modify source-scanner.ts
# Generated from filesystem convention (deterministic vitest gate)

test -f src/engine/source-scanner.ts || { echo "FAIL: T025 — file not found: src/engine/source-scanner.ts" >&2; exit 1; }

pnpm vitest run src/engine/source-scanner.test.ts --reporter=verbose \
  || { echo "FAIL: T025 — vitest failed for src/engine/source-scanner.test.ts" >&2; exit 1; }

echo "PASS: T025 — Modify source-scanner.ts"

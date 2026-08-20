#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T026 — Modify define-ontology.ts
# Generated from filesystem convention (deterministic vitest gate)

test -f src/commands/define-ontology.ts || { echo "FAIL: T026 — file not found: src/commands/define-ontology.ts" >&2; exit 1; }

pnpm vitest run src/commands/define-ontology.test.ts --reporter=verbose \
  || { echo "FAIL: T026 — vitest failed for src/commands/define-ontology.test.ts" >&2; exit 1; }

echo "PASS: T026 — Modify define-ontology.ts"

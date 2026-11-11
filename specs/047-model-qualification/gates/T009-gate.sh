#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T009 — Create catalog-discovery.ts
# Generated from filesystem convention (deterministic test gate)

test -f src/adapters/models/catalog-discovery.ts || { echo "FAIL: T009 — file not found: src/adapters/models/catalog-discovery.ts" >&2; exit 1; }

pnpm vitest run src/adapters/models/catalog-discovery.test.ts --reporter=verbose \
  || { echo "FAIL: T009 — test failed for src/adapters/models/catalog-discovery.test.ts" >&2; exit 1; }

echo "PASS: T009 — Create catalog-discovery.ts"

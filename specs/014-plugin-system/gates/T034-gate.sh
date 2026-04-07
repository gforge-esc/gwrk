#!/bin/bash
# AUTHORED
set -euo pipefail

# Task T034: Implement src/plugins/migrate.ts
test -f src/plugins/migrate.ts
test -f src/plugins/migrate.test.ts

# Verify no 'any' types in migrate.ts (biome noExplicitAny)
! grep -n ': any' src/plugins/migrate.ts || { echo "FAIL: migrate.ts contains explicit 'any' types"; exit 1; }

# Run tests — no masking with || echo
pnpm vitest run src/plugins/migrate.test.ts --reporter=verbose

echo "PASS: T034 — Implement src/plugins/migrate.ts"

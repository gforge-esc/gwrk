#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/plugins/manifest.test.ts
pnpm vitest run src/plugins/manifest.test.ts --reporter=verbose

echo "PASS: T005 — Implement src/plugins/manifest.test.ts"

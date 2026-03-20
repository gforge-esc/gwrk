#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/plugins/loader.test.ts
pnpm vitest run src/plugins/loader.test.ts --reporter=verbose

echo "PASS: T006 — Implement src/plugins/loader.test.ts"

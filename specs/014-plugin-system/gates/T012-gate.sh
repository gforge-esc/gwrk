#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/plugins/skill-runtime.test.ts
pnpm vitest run src/plugins/skill-runtime.test.ts --reporter=verbose

echo "PASS: T012 — Implement src/plugins/skill-runtime.test.ts"

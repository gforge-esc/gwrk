#!/bin/bash
set -euo pipefail
# Gate: T004 — Implement src/engine/readiness-scanner.ts

test -f src/engine/readiness-scanner.ts
pnpm vitest run src/engine/readiness-scanner.test.ts

echo "PASS: T004 — Readiness scanner implemented"

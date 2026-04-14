#!/bin/bash
set -euo pipefail
# Gate: T019 — Implement src/engine/drift-detector.ts

test -f src/engine/drift-detector.ts
pnpm vitest run src/engine/drift-detector.test.ts

echo "PASS: T019 — Drift detector implemented"

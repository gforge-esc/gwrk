#!/bin/bash
# AUTHORED
set -euo pipefail

file="src/engine/harvest.test.ts"
test -f "$file" || { echo "FAIL: T026 — file not found: $file" >&2; exit 1; }
pnpm vitest run "$file" --reporter=verbose || { echo "FAIL: T026 — vitest failed for $file" >&2; exit 1; }
echo "PASS: T026 — Implement src/engine/harvest.test.ts"

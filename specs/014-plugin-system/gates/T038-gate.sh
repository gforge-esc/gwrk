#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/engine/router.ts \
  || { echo "FAIL: T038 — file not found: src/engine/router.ts" >&2; exit 1; }
grep -q 'export async function selectBackend' src/engine/router.ts \
  || { echo "FAIL: T038 — src/engine/router.ts missing 'export async function selectBackend'" >&2; exit 1; }

echo "PASS: T038 — Implement src/engine/router.ts"

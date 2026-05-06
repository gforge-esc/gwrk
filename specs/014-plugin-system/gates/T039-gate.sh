#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/engine/quota.ts \
  || { echo "FAIL: T039 — file not found: src/engine/quota.ts" >&2; exit 1; }
grep -q 'export async function quotaProbe' src/engine/quota.ts \
  || { echo "FAIL: T039 — src/engine/quota.ts missing 'export async function quotaProbe'" >&2; exit 1; }

echo "PASS: T039 — Implement src/engine/quota.ts"

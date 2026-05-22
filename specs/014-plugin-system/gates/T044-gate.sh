#!/bin/bash
set -euo pipefail
# AUTHORED

test -f src/engine/quota.ts || { echo "FAIL: T044 — file not found: src/engine/quota.ts" >&2; exit 1; }
grep -q 'export async function quotaProbe' src/engine/quota.ts || { echo "FAIL: T044 — src/engine/quota.ts missing 'export async function quotaProbe'" >&2; exit 1; }

echo "PASS: T044 — Implement src/engine/quota.ts"

#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/engine/quota.ts
grep -q 'quotaProbe' src/engine/quota.ts

echo "PASS: T025 — Implement src/engine/quota.ts"

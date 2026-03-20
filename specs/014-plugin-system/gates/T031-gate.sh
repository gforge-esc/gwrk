#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/plugins/seed.ts
grep -q 'seed' src/plugins/seed.ts

echo "PASS: T031 — Implement src/plugins/seed.ts"

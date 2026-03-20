#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/engine/router.ts
grep -q 'selectBackend' src/engine/router.ts

echo "PASS: T024 — Implement src/engine/router.ts"

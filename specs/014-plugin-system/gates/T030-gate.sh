#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/plugins/migrate.ts
grep -q 'migrate' src/plugins/migrate.ts

echo "PASS: T030 — Implement src/plugins/migrate.ts"

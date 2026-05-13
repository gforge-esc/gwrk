#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T007 — Implement src/db/index.ts

test -f src/db/index.ts \
  || { echo "FAIL: T007 — file not found: src/db/index.ts" >&2; exit 1; }

grep -q 'export function getDb' src/db/index.ts \
  || { echo "FAIL: T007 — src/db/index.ts missing 'getDb'" >&2; exit 1; }

grep -q 'runMigrations' src/db/index.ts \
  || { echo "FAIL: T007 — src/db/index.ts missing 'runMigrations'" >&2; exit 1; }

echo "PASS: T007 — Implement src/db/index.ts"

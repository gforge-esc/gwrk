#!/bin/bash
set -euo pipefail
# AUTHORED

test -f "src/db/migrations/001-initial.sql" || { echo "FAIL: T008 — file not found: src/db/migrations/001-initial.sql" >&2; exit 1; }
wc -c < "src/db/migrations/001-initial.sql" | grep -q "[1-9]" || { echo "FAIL: T008 — src/db/migrations/001-initial.sql is empty" >&2; exit 1; }

echo "PASS: T008 — Implement src/db/migrations/001-initial.sql"

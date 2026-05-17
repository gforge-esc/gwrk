#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T008 — Implement src/db/migrations/001-initial.sql

test -f src/db/migrations/001-initial.sql \
  || { echo "FAIL: T008 — file not found: src/db/migrations/001-initial.sql" >&2; exit 1; }

grep -qi 'CREATE TABLE.*projects' src/db/migrations/001-initial.sql \
  || { echo "FAIL: T008 — src/db/migrations/001-initial.sql missing 'projects' table" >&2; exit 1; }

grep -qi 'CREATE TABLE.*runs' src/db/migrations/001-initial.sql \
  || { echo "FAIL: T008 — src/db/migrations/001-initial.sql missing 'runs' table" >&2; exit 1; }

echo "PASS: T008 — Implement src/db/migrations/001-initial.sql"

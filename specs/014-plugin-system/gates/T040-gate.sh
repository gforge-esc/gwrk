#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/db/migrations/004-routing-history.sql \
  || { echo "FAIL: T040 — file not found: src/db/migrations/004-routing-history.sql" >&2; exit 1; }
grep -q 'CREATE TABLE IF NOT EXISTS routing_decisions' src/db/migrations/004-routing-history.sql \
  || { echo "FAIL: T040 — src/db/migrations/004-routing-history.sql missing table definition" >&2; exit 1; }

echo "PASS: T040 — Implement src/db/migrations/004-routing-history.sql"

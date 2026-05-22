#!/bin/bash
set -euo pipefail
# AUTHORED

test -f src/db/migrations/004-routing-history.sql || { echo "FAIL: T045 — file not found: src/db/migrations/004-routing-history.sql" >&2; exit 1; }
grep -q 'CREATE TABLE IF NOT EXISTS routing_history' src/db/migrations/004-routing-history.sql || { echo "FAIL: T045 — src/db/migrations/004-routing-history.sql missing 'CREATE TABLE IF NOT EXISTS routing_history'" >&2; exit 1; }

echo "PASS: T045 — Implement src/db/migrations/004-routing-history.sql"

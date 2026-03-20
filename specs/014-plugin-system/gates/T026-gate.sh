#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/db/migrations/004-routing-history.sql
grep -q 'routing_decisions' src/db/migrations/004-routing-history.sql

echo "PASS: T026 — Implement src/db/migrations/004-routing-history.sql"

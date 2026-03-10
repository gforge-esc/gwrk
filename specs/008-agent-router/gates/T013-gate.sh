#!/bin/bash
set -euo pipefail
# Gate: T013 — Implement src/db/migrations/003-routing-decisions.sql
# Asserts: Derived from task description

test -f src/db/migrations/003-routing-decisions.sql

echo "PASS: T013 — Implement src/db/migrations/003-routing-decisions.sql"

#!/bin/bash
set -euo pipefail
# Gate: T001 — Implement src/db/migrations/006-build-plan.sql

test -f src/db/migrations/006-build-plan.sql
grep -q "plan_features" src/db/migrations/006-build-plan.sql
grep -q "plan_phases" src/db/migrations/006-build-plan.sql
grep -q "plan_edges" src/db/migrations/006-build-plan.sql
grep -q "plan_proposals" src/db/migrations/006-build-plan.sql

echo "PASS: T001 — SQLite schema defined"

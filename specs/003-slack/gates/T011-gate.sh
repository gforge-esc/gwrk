#!/bin/bash
set -euo pipefail
# Gate: T011 — Implement src/db/migrations/003_pr_tracking.sql
# Asserts: Derived from task description

test -f src/db/migrations/003_pr_tracking.sql
# Required identifiers
grep -q 'pr_number' src/db/migrations/003_pr_tracking.sql
grep -q 'pr_url' src/db/migrations/003_pr_tracking.sql
grep -q 'runs' src/db/migrations/003_pr_tracking.sql

echo "PASS: T011 — Implement src/db/migrations/003_pr_tracking.sql"

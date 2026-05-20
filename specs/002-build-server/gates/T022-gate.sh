#!/bin/bash
# AUTHORED
set -euo pipefail
test -f src/db/migrations/0001_runs.sql || { echo "FAIL: T022 — file not found: src/db/migrations/0001_runs.sql" >&2; exit 1; }
echo "PASS: T022 — Implement src/db/migrations/0001_runs.sql"

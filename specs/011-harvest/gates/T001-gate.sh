#!/bin/bash
# AUTHORED
set -euo pipefail

# Assertion #1: Check for migration file
test -f src/db/migrations/005-compression.sql || { echo "FAIL: src/db/migrations/005-compression.sql missing" >&2; exit 1; }

# Assertion #2: Verify compression table creation
grep -q "CREATE TABLE IF NOT EXISTS compression" src/db/migrations/005-compression.sql || { echo "FAIL: compression table not created" >&2; exit 1; }

echo "PASS: T001 — Verify src/db/migrations/005-compression.sql exists and is correct"

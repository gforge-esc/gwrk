#!/bin/bash
# AUTHORED
set -euo pipefail

# Assertion #1: Check for migration file
ls src/db/migrations/003-compression.sql > /dev/null

# Assertion #2: Verify compression table creation
grep -q "CREATE TABLE IF NOT EXISTS compression" src/db/migrations/003-compression.sql

# Assertion #3: Verify runs table alterations
grep -q "ALTER TABLE runs ADD COLUMN status TEXT" src/db/migrations/003-compression.sql
grep -q "ALTER TABLE runs ADD COLUMN merge_commit_sha TEXT" src/db/migrations/003-compression.sql

echo "PASS: T001 — Implement src/db/migrations/003-compression.sql (NEW)"

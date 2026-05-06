#!/bin/bash
# T001: Implement src/db/migrations/006-build-plan.sql
set -e
FILE="src/db/migrations/006-build-plan.sql"
test -f "$FILE"
grep -q "CREATE TABLE IF NOT EXISTS plan_features" "$FILE"
grep -q "CREATE TABLE IF NOT EXISTS plan_phases" "$FILE"
grep -q "CREATE TABLE IF NOT EXISTS plan_edges" "$FILE"
grep -q "CREATE TABLE IF NOT EXISTS plan_proposals" "$FILE"
echo "T001: Migration file exists and contains expected tables."
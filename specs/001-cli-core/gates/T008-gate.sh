#!/bin/bash
set -euo pipefail
# Gate: T008 — Implement src/db/migrations/001-initial.sql
# Asserts: Derived from task description

test -f src/db/migrations/001-initial.sql

echo "PASS: T008 — Implement src/db/migrations/001-initial.sql"

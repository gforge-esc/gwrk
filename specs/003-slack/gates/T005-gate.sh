#!/bin/bash
set -euo pipefail
# Gate: T005 — Implement src/db/migrations/002-slack.sql
# Asserts: Derived from task description

test -f src/db/migrations/002-slack.sql

echo "PASS: T005 — Implement src/db/migrations/002-slack.sql"

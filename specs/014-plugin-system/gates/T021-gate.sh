#!/bin/bash
# AUTHORED
set -euo pipefail

# Task T021: Implement src/db/migrations/003-agent-context.sql
# Note: P3 agent named this 003 (not 004 as originally planned in tasks.json).

test -f src/db/migrations/003-agent-context.sql \
  || { echo "FAIL: T021 — migration file not found: src/db/migrations/003-agent-context.sql" >&2; exit 1; }

grep -q 'agent_context' src/db/migrations/003-agent-context.sql \
  || { echo "FAIL: T021 — migration missing 'agent_context' table definition" >&2; exit 1; }

echo "PASS: T021 — Implement src/db/migrations/003-agent-context.sql"

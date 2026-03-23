#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/db/migrations/004-agent-context.sql
grep -q 'agent_context' src/db/migrations/004-agent-context.sql

echo "PASS: T021 — Implement src/db/migrations/004-agent-context.sql"

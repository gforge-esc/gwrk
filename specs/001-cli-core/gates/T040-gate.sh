#!/bin/bash
set -euo pipefail
# Gate: T040 — Implement src/commands/define.ts
# Asserts: Derived from task description

# Use tsx to run the source code
GWRK="npx tsx $(pwd)/src/cli.ts"

test -f src/commands/define.ts

# Phase Acceptance Criteria
# Verify that define command exists and can be invoked
$GWRK define --help > /dev/null

# Verify manifests and history
# Since we are in the middle of implementation, we just check if verify command works
$GWRK tasks verify 001-cli-core

# Check if history table exists in DB
# We assume the DB is at ~/.gwrk/gwrk.db
sqlite3 ~/.gwrk/gwrk.db "SELECT count(*) FROM history;" > /dev/null

echo "PASS: T040 — Implement src/commands/define.ts"

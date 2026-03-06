#!/usr/bin/env bash
# Gate: T008 — Implement status CLI command
set -euo pipefail

# Assertion #1: src/commands/status.ts exists
test -f src/commands/status.ts || { echo "FAIL: src/commands/status.ts not found"; exit 1; }

# Assertion #2: status command defined
grep -q "new Command('status')" src/commands/status.ts || { echo "FAIL: 'status' command not defined"; exit 1; }

# Assertion #3: status command registered in src/cli.ts
grep -q "status" src/cli.ts || { echo "FAIL: status command not registered in src/cli.ts"; exit 1; }

# Assertion #4: queries /api/status endpoint
grep -q "/api/status" src/commands/status.ts || { echo "FAIL: status command does not query /api/status"; exit 1; }

echo "PASS: T008"

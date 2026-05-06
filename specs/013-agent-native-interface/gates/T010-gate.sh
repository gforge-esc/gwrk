#!/bin/bash
set -euo pipefail
# Gate: T010 — Add project specs and gates subcommands
# Source: spec FR-005
# AUTHORED

# Assertion #1: specs subcommand defined
grep -q 'specs' src/commands/project.ts

# Assertion #2: gates subcommand defined
grep -q 'gates' src/commands/project.ts

# Assertion #3: E2E — project specs --format json returns array
RESULT=$(gwrk project specs --format json 2>/dev/null || true)
echo "$RESULT" | jq -e '.[0].id' > /dev/null || { echo "FAIL: project specs --format json invalid"; exit 1; }

# Assertion #4: E2E — project gates --format json returns array
RESULT=$(gwrk project gates --format json 2>/dev/null || true)
echo "$RESULT" | jq -e '.[0].taskId' > /dev/null || { echo "FAIL: project gates --format json invalid"; exit 1; }

echo "PASS: T010 — Add project specs and gates subcommands"

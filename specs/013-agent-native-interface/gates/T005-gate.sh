#!/bin/bash
set -euo pipefail
# Gate: T005 — Retrofit queryable commands for --format json
# Source: plan Phase 1.2 queryable command table
# AUTHORED

# Assertion #1: tasks.ts uses CommandOutput
grep -qE 'CommandOutput|createOutput' src/commands/tasks.ts

# Assertion #2: status.ts uses CommandOutput
grep -qE 'CommandOutput|createOutput' src/commands/status.ts

# Assertion #3: E2E — tasks list --format json produces valid JSON
RESULT=$(gwrk tasks list 000-tdd-infrastructure --format json 2>/dev/null || true)
echo "$RESULT" | jq . > /dev/null || { echo "FAIL: tasks list --format json not valid JSON"; exit 1; }

# Assertion #4: E2E — status --format json produces valid JSON
RESULT=$(gwrk status --format json 2>/dev/null || true)
echo "$RESULT" | jq . > /dev/null || { echo "FAIL: status --format json not valid JSON"; exit 1; }

echo "PASS: T005 — Retrofit queryable commands for --format json"

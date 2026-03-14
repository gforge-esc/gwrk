#!/bin/bash
set -euo pipefail
# Gate: T011 — Rewrite help text for agent discoverability
# Source: spec FR-008, DM-003
# AUTHORED

# Assertion #1: gate-check --help includes exit codes
gwrk gate-check --help 2>/dev/null | grep -qi 'exit code' || { echo "FAIL: gate-check --help missing exit codes"; exit 1; }

# Assertion #2: gate-check --help includes command type
gwrk gate-check --help 2>/dev/null | grep -qiE 'type:|verifier|query|mutator' || { echo "FAIL: gate-check --help missing command type"; exit 1; }

# Assertion #3: tasks --help mentions --format json
gwrk tasks --help 2>/dev/null | grep -q '\-\-format' || { echo "FAIL: tasks --help missing --format"; exit 1; }

# Assertion #4: ship --help declares mutation scope
gwrk ship --help 2>/dev/null | grep -qi 'mutat' || { echo "FAIL: ship --help missing mutation declaration"; exit 1; }

# Assertion #5: CommandMeta type exists somewhere
grep -rq 'CommandMeta' src/commands/ || { echo "FAIL: CommandMeta not found in commands/"; exit 1; }

echo "PASS: T011 — Rewrite help text for agent discoverability"

#!/usr/bin/env bash
# Gate: T005 — Create server CLI commands
# Contract: src/commands/server.ts must export serverCommand with start and stop subcommands
set -euo pipefail

FILE="src/commands/server.ts"
# Assertion #1
test -f "$FILE" || { echo "FAIL: $FILE not found"; exit 1; }

# Verify exports
# Assertion #2
grep -q 'export.*serverCommand\|export const serverCommand\|export function' "$FILE" || { echo "FAIL: serverCommand not exported"; exit 1; }

# Verify start and stop subcommands
# Assertion #3
grep -q "'start'\|\"start\"" "$FILE" || { echo "FAIL: 'start' subcommand not defined"; exit 1; }
# Assertion #4
grep -q "'stop'\|\"stop\"" "$FILE" || { echo "FAIL: 'stop' subcommand not defined"; exit 1; }

# Verify startServer import
# Assertion #5
grep -q 'startServer' "$FILE" || { echo "FAIL: startServer not imported"; exit 1; }

echo "PASS: T005"

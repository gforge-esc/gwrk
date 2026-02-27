#!/usr/bin/env bash
# Gate: T017 — Create gwrk compression Commander command
# Contract: src/commands/compression.ts must export compressionCommand
set -euo pipefail

FILE="src/commands/compression.ts"
# Assertion #1
test -f "$FILE" || { echo "FAIL: $FILE does not exist" >&2; exit 1; }

# Assertion #2
grep -q 'export.*compressionCommand\|export.*compression' "$FILE" || { echo "FAIL: compressionCommand not exported" >&2; exit 1; }
# Assertion #3
grep -q 'Command\|command' "$FILE" || { echo "FAIL: Commander command not defined" >&2; exit 1; }
# Assertion #4
grep -q 'json' "$FILE" || { echo "FAIL: --json flag not implemented" >&2; exit 1; }
# Assertion #5
grep -q '\-\-all\|all' "$FILE" || { echo "FAIL: --all flag not implemented" >&2; exit 1; }
# Assertion #6
grep -q 'computeCompression\|collectTimestamps' "$FILE" || { echo "FAIL: compression engine not called" >&2; exit 1; }

echo "PASS: T017 — compression command created with --json and --all support"

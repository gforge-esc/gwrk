#!/usr/bin/env bash
# Gate: T018 — Register effort and compression commands in CLI
# Contract: src/cli.ts must import and register both commands
set -euo pipefail

FILE="src/cli.ts"
# Assertion #1
test -f "$FILE" || { echo "FAIL: $FILE does not exist" >&2; exit 1; }

# Assertion #2
grep -q 'effortCommand\|effort' "$FILE" || { echo "FAIL: effort command not imported/registered in cli.ts" >&2; exit 1; }
# Assertion #3
grep -q 'compressionCommand\|compression' "$FILE" || { echo "FAIL: compression command not imported/registered in cli.ts" >&2; exit 1; }
# Assertion #4
grep -q 'addCommand' "$FILE" || { echo "FAIL: addCommand not found — commands not registered" >&2; exit 1; }

echo "PASS: T018 — effort and compression commands registered in cli.ts"

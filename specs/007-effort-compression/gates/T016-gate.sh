#!/usr/bin/env bash
# Gate: T016 — Create gwrk effort Commander command
# Contract: src/commands/effort.ts must export effortCommand
set -euo pipefail

FILE="src/commands/effort.ts"
# Assertion #1
test -f "$FILE" || { echo "FAIL: $FILE does not exist" >&2; exit 1; }

# Assertion #2
grep -q 'export.*effortCommand\|export.*effort' "$FILE" || { echo "FAIL: effortCommand not exported" >&2; exit 1; }
# Assertion #3
grep -q 'Command\|command' "$FILE" || { echo "FAIL: Commander command not defined" >&2; exit 1; }
# Assertion #4
grep -q 'json' "$FILE" || { echo "FAIL: --json flag not implemented" >&2; exit 1; }
# Assertion #5
grep -q 'computeEffort\|extractStories' "$FILE" || { echo "FAIL: effort engine not called" >&2; exit 1; }

echo "PASS: T016 — effort command created with --json support"

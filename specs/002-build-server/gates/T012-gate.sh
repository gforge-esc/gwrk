#!/usr/bin/env bash
# Gate: T012 — Register status command in CLI
set -euo pipefail

FILE="src/cli.ts"
# Assertion #1
grep -q 'statusCommand\|status' "$FILE" || { echo "FAIL: statusCommand not imported in cli.ts"; exit 1; }
# Assertion #2
grep -q 'addCommand.*status\|addCommand(statusCommand' "$FILE" || { echo "FAIL: statusCommand not registered"; exit 1; }

echo "PASS: T012"

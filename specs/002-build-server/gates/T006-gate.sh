#!/usr/bin/env bash
# Gate: T006 — Register server command in CLI
set -euo pipefail

FILE="src/cli.ts"
# Assertion #1
grep -q 'serverCommand\|server' "$FILE" || { echo "FAIL: serverCommand not imported in cli.ts"; exit 1; }
# Assertion #2
grep -q 'addCommand.*server\|addCommand(serverCommand' "$FILE" || { echo "FAIL: serverCommand not registered via addCommand"; exit 1; }

echo "PASS: T006"

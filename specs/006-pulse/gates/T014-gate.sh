#!/usr/bin/env bash
# Gate: T014 — Pulse command unit tests
set -euo pipefail

FILE="src/commands/pulse.test.ts"

# Assertion #1: File exists
test -f "$FILE" || { echo "FAIL #1: $FILE does not exist"; exit 1; }

# Assertion #2: pulse command tested
grep -q "pulse" "$FILE" || { echo "FAIL #2: pulse command tests missing"; exit 1; }

# Assertion #3: scan subcommand tested
grep -q "scan" "$FILE" || { echo "FAIL #3: pulse scan tests missing"; exit 1; }

# Assertion #4: --json output tested
grep -q "json" "$FILE" || { echo "FAIL #4: --json output tests missing"; exit 1; }

# Assertion #5: Error cases tested
grep -q "exit.*1\|process.exit\|error\|Error" "$FILE" || { echo "FAIL #5: error case tests missing"; exit 1; }

# Assertion #6: Tests pass
npx vitest run src/commands/pulse.test.ts --reporter=verbose 2>&1 || { echo "FAIL #6: pulse command tests did not pass"; exit 1; }

echo "PASS: T014"

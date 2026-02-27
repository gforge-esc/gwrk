#!/usr/bin/env bash
# Gate: T011 — gwrk pulse scan command
set -euo pipefail

FILE="src/commands/pulse.ts"

# Assertion #1: File exists
test -f "$FILE" || { echo "FAIL #1: $FILE does not exist"; exit 1; }

# Assertion #2: registerPulseCommands exported
grep -q "export.*function registerPulseCommands\|export.*registerPulseCommands" "$FILE" || { echo "FAIL #2: registerPulseCommands not exported"; exit 1; }

# Assertion #3: scan subcommand registered
grep -q "scan" "$FILE" || { echo "FAIL #3: scan subcommand not found"; exit 1; }

# Assertion #4: --json option supported
grep -q "\-\-json\|json" "$FILE" || { echo "FAIL #4: --json option not found"; exit 1; }

# Assertion #5: Calls scanRepository
grep -q "scanRepository" "$FILE" || { echo "FAIL #5: scanRepository not called"; exit 1; }

# Assertion #6: Error handling for non-git repo
grep -q "Not a git repository\|not.*git" "$FILE" || { echo "FAIL #6: non-git-repo error handling missing"; exit 1; }

echo "PASS: T011"

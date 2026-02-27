#!/usr/bin/env bash
# Gate: T012 — gwrk pulse command (root)
set -euo pipefail

FILE="src/commands/pulse.ts"

# Assertion #1: File exists
test -f "$FILE" || { echo "FAIL #1: $FILE does not exist"; exit 1; }

# Assertion #2: Reads config.pulse
grep -q "pulse" "$FILE" || { echo "FAIL #2: pulse config reading not found"; exit 1; }

# Assertion #3: Iterates repos
grep -q "repos" "$FILE" || { echo "FAIL #3: repos iteration not found"; exit 1; }

# Assertion #4: Error for no repos configured
grep -q "No repositories tracked\|no.*repositor" "$FILE" || { echo "FAIL #4: no-repos error message missing"; exit 1; }

echo "PASS: T012"

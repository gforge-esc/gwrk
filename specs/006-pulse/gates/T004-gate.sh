#!/usr/bin/env bash
# Gate: T004 — parseGitLog parser
set -euo pipefail

FILE="src/engine/pulse.ts"

# Assertion #1: File exists
test -f "$FILE" || { echo "FAIL #1: $FILE does not exist"; exit 1; }

# Assertion #2: parseGitLog exported
grep -q "export.*function parseGitLog" "$FILE" || { echo "FAIL #2: parseGitLog not exported"; exit 1; }

# Assertion #3: ParsedCommit type referenced
grep -q "ParsedCommit" "$FILE" || { echo "FAIL #3: ParsedCommit type not referenced"; exit 1; }

# Assertion #4: hash field in parser
grep -q "hash" "$FILE" || { echo "FAIL #4: hash field not found in parser"; exit 1; }

# Assertion #5: timestamp field in parser
grep -q "timestamp" "$FILE" || { echo "FAIL #5: timestamp field not found in parser"; exit 1; }

echo "PASS: T004"

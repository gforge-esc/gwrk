#!/usr/bin/env bash
# Gate: T002 — Git shell helpers
set -euo pipefail

FILE="src/utils/git.ts"

# Assertion #1: File exists
test -f "$FILE" || { echo "FAIL #1: $FILE does not exist"; exit 1; }

# Assertion #2: detectDefaultBranch exported
grep -q "export.*function detectDefaultBranch" "$FILE" || { echo "FAIL #2: detectDefaultBranch not exported"; exit 1; }

# Assertion #3: gitLog exported
grep -q "export.*function gitLog" "$FILE" || { echo "FAIL #3: gitLog not exported"; exit 1; }

# Assertion #4: gitBranches exported
grep -q "export.*function gitBranches" "$FILE" || { echo "FAIL #4: gitBranches not exported"; exit 1; }

# Assertion #5: gitLineCount exported
grep -q "export.*function gitLineCount" "$FILE" || { echo "FAIL #5: gitLineCount not exported"; exit 1; }

# Assertion #6: Uses child_process
grep -q "child_process" "$FILE" || { echo "FAIL #6: child_process not imported"; exit 1; }

# Assertion #7: main branch fallback
grep -q "main" "$FILE" || { echo "FAIL #7: main branch fallback not found"; exit 1; }

# Assertion #8: master branch fallback
grep -q "master" "$FILE" || { echo "FAIL #8: master branch fallback not found"; exit 1; }

echo "PASS: T002"

#!/usr/bin/env bash
# Gate: T009 — Extend GwrkConfigSchema with pulse section
set -euo pipefail

FILE="src/utils/config.ts"

# Assertion #1: File exists
test -f "$FILE" || { echo "FAIL #1: $FILE does not exist"; exit 1; }

# Assertion #2: pulse key in schema
grep -q "pulse" "$FILE" || { echo "FAIL #2: pulse section not found in config schema"; exit 1; }

# Assertion #3: repos array in pulse schema
grep -q "repos" "$FILE" || { echo "FAIL #3: repos field not found in pulse config"; exit 1; }

# Assertion #4: Optional (pulse section doesn't break existing configs)
grep -q "optional" "$FILE" || { echo "FAIL #4: pulse section should be optional"; exit 1; }

# Assertion #5: TypeScript compiles
npx tsc --noEmit 2>&1 || { echo "FAIL #5: TypeScript compilation failed"; exit 1; }

echo "PASS: T009"

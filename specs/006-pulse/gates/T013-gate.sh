#!/usr/bin/env bash
# Gate: T013 — Register pulse command in CLI entrypoint
set -euo pipefail

FILE="src/cli.ts"

# Assertion #1: File exists
test -f "$FILE" || { echo "FAIL #1: $FILE does not exist"; exit 1; }

# Assertion #2: Import pulse commands
grep -q "pulse" "$FILE" || { echo "FAIL #2: pulse import not found in cli.ts"; exit 1; }

# Assertion #3: registerPulseCommands called or pulseCommand added
grep -q "registerPulseCommands\|pulseCommand\|addCommand.*pulse" "$FILE" || { echo "FAIL #3: pulse command not registered"; exit 1; }

# Assertion #4: TypeScript compiles
npx tsc --noEmit 2>&1 || { echo "FAIL #4: TypeScript compilation failed"; exit 1; }

echo "PASS: T013"

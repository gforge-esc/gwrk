#!/bin/bash
# AUTHORED
set -euo pipefail

# Task T011: Implement src/utils/agent-layer.ts
# Description: Support ANSI stripping and binary guards for skill output

FILE="src/utils/agent-layer.ts"

# Assertion 1: File exists
test -f "$FILE"

# Assertion 2: ANSI stripping logic exists
grep -q "stripAnsi" "$FILE"
grep -q "replace" "$FILE"

# Assertion 3: Binary guard logic exists
grep -q "guardBinary" "$FILE"
grep -q "includes(\"\\\\0\")" "$FILE"

# Assertion 4: Truncation logic exists
grep -q "truncateOverflow" "$FILE"
grep -q "8192" "$FILE"

# Assertion 5: Composition logic exists
grep -q "processForAgent" "$FILE"

echo "PASS: T011 — Implement src/utils/agent-layer.ts"

#!/usr/bin/env bash
# Gate: T016 — Create context compiler
# Contract: src/server/context.ts must export compileContext and writeContextToSandbox
set -euo pipefail

FILE="src/server/context.ts"
# Assertion #1
test -f "$FILE" || { echo "FAIL: $FILE not found"; exit 1; }

# Assertion #2
grep -q 'export.*function compileContext\|export async function compileContext' "$FILE" || { echo "FAIL: compileContext not exported"; exit 1; }
# Assertion #3
grep -q 'export.*function writeContextToSandbox\|export async function writeContextToSandbox' "$FILE" || { echo "FAIL: writeContextToSandbox not exported"; exit 1; }

# Verify it reads governance rules
# Assertion #4
grep -q '\.agent/rules\|rules' "$FILE" || { echo "FAIL: governance rules path not referenced"; exit 1; }

# Verify it reads spec.md  
# Assertion #5
grep -q 'spec\.md' "$FILE" || { echo "FAIL: spec.md not referenced"; exit 1; }

echo "PASS: T016"

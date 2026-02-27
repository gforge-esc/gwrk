#!/usr/bin/env bash
# Gate: T022 — Create JSONL persistence writer
# Contract: src/server/persistence.ts must export persistDispatch
set -euo pipefail

FILE="src/server/persistence.ts"
# Assertion #1
test -f "$FILE" || { echo "FAIL: $FILE not found"; exit 1; }

# Assertion #2
grep -q 'export.*function persistDispatch\|export function persistDispatch' "$FILE" || { echo "FAIL: persistDispatch not exported"; exit 1; }

# Verify JSONL target
# Assertion #3
grep -q 'dispatches\.jsonl' "$FILE" || { echo "FAIL: dispatches.jsonl path not referenced"; exit 1; }

# Verify Zod validation
# Assertion #4
grep -q 'parse\|safeParse\|validate' "$FILE" || { echo "FAIL: Zod validation not found"; exit 1; }

echo "PASS: T022"

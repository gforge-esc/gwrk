#!/usr/bin/env bash
# Gate: T015 — Implement dispatch persistence
set -euo pipefail

# Assertion #1: src/server/persistence.ts exists
test -f src/server/persistence.ts || { echo "FAIL: src/server/persistence.ts not found"; exit 1; }

# Assertion #2: persistDispatch exported
grep -q "export.*persistDispatch" src/server/persistence.ts || { echo "FAIL: persistDispatch not exported"; exit 1; }

# Assertion #3: appends to dispatches.jsonl
grep -q "dispatches.jsonl" src/server/persistence.ts && grep -q "append" src/server/persistence.ts || { echo "FAIL: dispatches.jsonl append logic missing"; exit 1; }

# Assertion #4: uses JSON.stringify
grep -q "JSON.stringify" src/server/persistence.ts || { echo "FAIL: JSON stringification missing"; exit 1; }

echo "PASS: T015"

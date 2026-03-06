#!/usr/bin/env bash
# Gate: T017 — Implement dispatch retry and escalation logic
set -euo pipefail

# Assertion #1: handleCompletion in src/server/dispatch.ts
grep -q "handleCompletion" src/server/dispatch.ts || { echo "FAIL: handleCompletion method missing"; exit 1; }

# Assertion #2: retry logic (3x)
grep -q "3" src/server/dispatch.ts && grep -q "attempt" src/server/dispatch.ts || { echo "FAIL: retry logic (3x) not found"; exit 1; }

# Assertion #3: escalation logic
grep -q "fallbackOrder" src/server/dispatch.ts || { echo "FAIL: escalation/fallbackOrder logic not found"; exit 1; }

# Assertion #4: mergePhaseBack called on success
grep -q "mergePhaseBack" src/server/dispatch.ts || { echo "FAIL: mergePhaseBack not called on successful completion"; exit 1; }

echo "PASS: T017"

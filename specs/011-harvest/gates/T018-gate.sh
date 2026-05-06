#!/bin/bash
# AUTHORED
set -euo pipefail

# Assertion #1: Check for getCompressionRecord import in harvest.ts
grep -q "getCompressionRecord" src/engine/harvest.ts || { echo "FAIL: getCompressionRecord not imported in src/engine/harvest.ts" >&2; exit 1; }

# Assertion #2: Check for idempotency guard in harvestFeature
# Expecting a check before the main logic
if ! grep -A 15 "async function harvestFeature" src/engine/harvest.ts | grep -q "getCompressionRecord"; then
  echo "FAIL: Idempotency guard (getCompressionRecord) missing in harvestFeature" >&2
  exit 1
fi

echo "PASS: T018 — Implement src/engine/harvest.ts idempotency guard"

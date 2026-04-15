#!/bin/bash
# AUTHORED
set -euo pipefail

# Assertion #1: Check that it.todo is gone from harvest.test.ts
if grep -q "it.todo" src/engine/harvest.test.ts; then
  echo "FAIL: it.todo still present in src/engine/harvest.test.ts" >&2
  exit 1
fi

# Assertion #2: Ensure expectations exist for the new tests
# We expect at least more expectations than before (we had few, now we should have many)
EXPECT_COUNT=$(grep -c "expect(" src/engine/harvest.test.ts)
if [ "$EXPECT_COUNT" -lt 5 ]; then
  echo "FAIL: Too few expectations in harvest.test.ts ($EXPECT_COUNT), tests might not be fully implemented" >&2
  exit 1
fi

echo "PASS: T020 — Implement src/engine/harvest.test.ts the 3 it.todo"

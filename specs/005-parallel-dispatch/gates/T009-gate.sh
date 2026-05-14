#!/bin/bash
# AUTHORED
set -euo pipefail

# Task T009: Verify src/utils/config.ts parallelism settings
# FR-004: Confirm maxClones and maxConcurrent are typed and defaulted

test -f src/utils/config.ts \
  || { echo "FAIL: T009 — file not found: src/utils/config.ts" >&2; exit 1; }

grep -q "maxClones" src/utils/config.ts \
  || { echo "FAIL: T009 — src/utils/config.ts missing 'maxClones' setting (FR-004)" >&2; exit 1; }

grep -q "maxConcurrent" src/utils/config.ts \
  || { echo "FAIL: T009 — src/utils/config.ts missing 'maxConcurrent' setting (FR-004)" >&2; exit 1; }

echo "PASS: T009 — Verify src/utils/config.ts parallelism settings"

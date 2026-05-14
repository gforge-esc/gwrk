#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T009 — Implement src/db/runs.ts

test -f src/db/runs.ts \
  || { echo "FAIL: T009 — file not found: src/db/runs.ts" >&2; exit 1; }

grep -q 'export function startRun' src/db/runs.ts \
  || { echo "FAIL: T009 — src/db/runs.ts missing 'startRun'" >&2; exit 1; }

grep -q 'export function finishRun' src/db/runs.ts \
  || { echo "FAIL: T009 — src/db/runs.ts missing 'finishRun'" >&2; exit 1; }

echo "PASS: T009 — Implement src/db/runs.ts"

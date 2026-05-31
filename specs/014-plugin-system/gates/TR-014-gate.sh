#!/bin/bash
# AUTHORED
set -euo pipefail

# TR-014: Unit | Phase-scope validation | Reverts cross-phase task mutations
pnpm vitest run src/plugins/review-plugin.test.ts -t "validatePhaseScope" || { echo "FAIL: TR-014 — validatePhaseScope test failed" >&2; exit 1; }

echo "PASS: TR-014 — Phase-scope validation reverts cross-phase task mutations"

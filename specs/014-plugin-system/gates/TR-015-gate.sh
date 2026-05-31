#!/bin/bash
# AUTHORED
set -euo pipefail

# TR-015: Integration | Ship loop with review plugin | End-to-end dispatch via plugin resolution
pnpm vitest run src/engine/ship-orchestrator.review.test.ts || { echo "FAIL: TR-015 — Ship loop with review plugin test failed" >&2; exit 1; }

echo "PASS: TR-015 — Ship loop with review plugin works"

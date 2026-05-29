#!/bin/bash
# AUTHORED
set -euo pipefail

# TR-013: Unit | resolveReviewPlugin() | Returns correct plugin for project type
pnpm vitest run src/plugins/review-plugin.test.ts -t "resolveReviewPlugin" || { echo "FAIL: TR-013 — resolveReviewPlugin test failed" >&2; exit 1; }

echo "PASS: TR-013 — resolveReviewPlugin() returns correct plugin"

#!/bin/bash
# AUTHORED
set -euo pipefail

# T047: Unit tests for ReviewPlugin
test -f src/plugins/review-plugin.test.ts
pnpm vitest run src/plugins/review-plugin.test.ts --reporter=verbose

echo "PASS: T047 — Implement src/plugins/review-plugin.test.ts"

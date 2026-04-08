#!/bin/bash
# AUTHORED
set -euo pipefail

# T049: ReviewPlugin interface + resolution
test -f src/plugins/review-plugin.ts
grep -q "ReviewPlugin" src/plugins/review-plugin.ts
grep -q "ReviewStep" src/plugins/review-plugin.ts
grep -q "resolveReviewPlugin" src/plugins/review-plugin.ts

echo "PASS: T049 — Implement src/plugins/review-plugin.ts"

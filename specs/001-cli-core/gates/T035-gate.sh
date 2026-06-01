#!/bin/bash
set -euo pipefail
# AUTHORED

test -f src/commands/metrics.ts \
  || { echo "FAIL: T035 — file not found: src/commands/metrics.ts" >&2; exit 1; }
grep -q 'metricsCommand' src/commands/metrics.ts \
  || { echo "FAIL: T035 — src/commands/metrics.ts missing 'metricsCommand'" >&2; exit 1; }

echo "PASS: T035 — Implement src/commands/metrics.ts"

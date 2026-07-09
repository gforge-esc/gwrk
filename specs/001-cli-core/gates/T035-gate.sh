#!/bin/bash
set -euo pipefail
# AUTHORED — updated: metrics.ts was named stats.ts during implementation

test -f src/commands/stats.ts \
  || { echo "FAIL: T035 — file not found: src/commands/stats.ts" >&2; exit 1; }
grep -q 'statsCommand' src/commands/stats.ts \
  || { echo "FAIL: T035 — src/commands/stats.ts missing 'statsCommand'" >&2; exit 1; }

echo "PASS: T035 — Implement src/commands/stats.ts (was planned as metrics.ts)"

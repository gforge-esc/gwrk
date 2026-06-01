#!/bin/bash
set -euo pipefail
# AUTHORED

test -f src/commands/pulse.ts \
  || { echo "FAIL: T026 — file not found: src/commands/pulse.ts" >&2; exit 1; }
grep -q 'renderPulseTable' src/commands/pulse.ts \
  || { echo "FAIL: T026 — src/commands/pulse.ts missing 'renderPulseTable'" >&2; exit 1; }

echo "PASS: T026 — Implement src/commands/pulse.ts"

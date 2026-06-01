#!/bin/bash
set -euo pipefail
# AUTHORED

test -f src/engine/pulse.ts \
  || { echo "FAIL: T029 — file not found: src/engine/pulse.ts" >&2; exit 1; }
grep -q 'parseGitLog' src/engine/pulse.ts \
  || { echo "FAIL: T029 — src/engine/pulse.ts missing 'parseGitLog'" >&2; exit 1; }

echo "PASS: T029 — Implement src/engine/pulse.ts"

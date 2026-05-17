#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T029 — Implement src/engine/pulse.ts

test -f src/engine/pulse.ts \
  || { echo "FAIL: T029 — file not found: src/engine/pulse.ts" >&2; exit 1; }

grep -q 'export function parseGitLog' src/engine/pulse.ts \
  || { echo "FAIL: T029 — src/engine/pulse.ts missing 'parseGitLog'" >&2; exit 1; }

grep -q 'export function generatePulseReport' src/engine/pulse.ts \
  || { echo "FAIL: T029 — src/engine/pulse.ts missing 'generatePulseReport'" >&2; exit 1; }

echo "PASS: T029 — Implement src/engine/pulse.ts"

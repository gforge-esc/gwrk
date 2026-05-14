#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T026 — Implement src/commands/pulse.ts

test -f src/commands/pulse.ts \
  || { echo "FAIL: T026 — file not found: src/commands/pulse.ts" >&2; exit 1; }

grep -q '.command("pulse")' src/commands/pulse.ts \
  || { echo "FAIL: T026 — src/commands/pulse.ts missing 'new Command(\"pulse\")'" >&2; exit 1; }

grep -q 'generatePulseReport' src/commands/pulse.ts \
  || { echo "FAIL: T026 — src/commands/pulse.ts missing 'generatePulseReport'" >&2; exit 1; }

echo "PASS: T026 — Implement src/commands/pulse.ts"

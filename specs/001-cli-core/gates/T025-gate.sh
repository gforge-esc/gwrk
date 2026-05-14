#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T025 — Implement src/commands/measure.ts

test -f src/commands/measure.ts \
  || { echo "FAIL: T025 — file not found: src/commands/measure.ts" >&2; exit 1; }

grep -q 'new Command("measure")' src/commands/measure.ts \
  || { echo "FAIL: T025 — src/commands/measure.ts missing 'new Command(\"measure\")'" >&2; exit 1; }

grep -q 'registerPulseSubcommands' src/commands/measure.ts \
  || { echo "FAIL: T025 — src/commands/measure.ts missing 'pulseCommand'" >&2; exit 1; }

echo "PASS: T025 — Implement src/commands/measure.ts"

#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T040 — Implement src/commands/define.ts (Phase 09: manifest)

test -f src/commands/define.ts \
  || { echo "FAIL: T040 — file not found: src/commands/define.ts" >&2; exit 1; }

grep -q 'writeManifest' src/commands/define.ts \
  || { echo "FAIL: T040 — src/commands/define.ts missing 'writeManifest'" >&2; exit 1; }

echo "PASS: T040 — Implement src/commands/define.ts (manifest)"

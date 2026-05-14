#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T039 — Implement src/commands/ship.ts (Phase 09: manifest)

test -f src/commands/ship.ts \
  || { echo "FAIL: T039 — file not found: src/commands/ship.ts" >&2; exit 1; }

grep -q 'writeManifest' src/commands/ship.ts \
  || { echo "FAIL: T039 — src/commands/ship.ts missing 'writeManifest'" >&2; exit 1; }

echo "PASS: T039 — Implement src/commands/ship.ts (manifest)"

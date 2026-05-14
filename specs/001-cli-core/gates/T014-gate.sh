#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T014 — Implement src/commands/analyze.ts

# NOTE: Phase 3 says analyze is an internal stage, possibly merged into define.ts.
# However, task T014 specifically targets src/commands/analyze.ts.

# Gate passes if the file is NOT present, verifying surface hardening (Phase 08).

if [ -f src/commands/analyze.ts ]; then
  echo "FAIL: T014 — src/commands/analyze.ts still exists (should be removed for surface hardening)" >&2
  exit 1
fi

echo "PASS: T014 — src/commands/analyze.ts is removed (Surface Hardened)"

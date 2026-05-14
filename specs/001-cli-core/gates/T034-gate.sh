#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T034 — Implement src/commands/run.ts

# NOTE: Phase 08 says dead files (run, metrics) are removed.
# Gate passes if the file is NOT present, verifying surface hardening.

if [ -f src/commands/run.ts ]; then
  echo "FAIL: T034 — src/commands/run.ts still exists (should be removed for surface hardening)" >&2
  exit 1
fi

echo "PASS: T034 — src/commands/run.ts is removed (Surface Hardened)"

#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T035 — Implement src/commands/metrics.ts

# NOTE: Phase 08 says dead files (run, metrics) are removed.
# Gate passes if the file is NOT present, verifying surface hardening.

if [ -f src/commands/metrics.ts ]; then
  echo "FAIL: T035 — src/commands/metrics.ts still exists (should be removed for surface hardening)" >&2
  exit 1
fi

echo "PASS: T035 — src/commands/metrics.ts is removed (Surface Hardened)"

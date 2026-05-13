#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T033 — Implement src/commands/new.ts

# Gate passes if the file is NOT present, verifying surface hardening (Phase 08).

if [ -f src/commands/new.ts ]; then
  echo "FAIL: T033 — src/commands/new.ts still exists (should be removed for surface hardening)" >&2
  exit 1
fi

echo "PASS: T033 — src/commands/new.ts is removed (Surface Hardened)"

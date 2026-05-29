#!/bin/bash
# AUTHORED
set -euo pipefail

# T055: src/plugins/manifest.ts (MODIFY: add tier: enforcement, scope)
test -f src/plugins/manifest.ts \
  || { echo "FAIL: T055 — file not found: src/plugins/manifest.ts" >&2; exit 1; }

grep -q "enforcement" src/plugins/manifest.ts \
  || { echo "FAIL: T055 — src/plugins/manifest.ts missing 'enforcement' tier" >&2; exit 1; }

grep -q "scope" src/plugins/manifest.ts \
  || { echo "FAIL: T055 — src/plugins/manifest.ts missing 'scope' field" >&2; exit 1; }

echo "PASS: T055 — Implement src/plugins/manifest.ts"

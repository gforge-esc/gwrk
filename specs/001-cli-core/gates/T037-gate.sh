#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T037 — Implement src/utils/manifest.ts

test -f src/utils/manifest.ts \
  || { echo "FAIL: T037 — file not found: src/utils/manifest.ts" >&2; exit 1; }

grep -q 'ExecutionManifestSchema' src/utils/manifest.ts \
  || { echo "FAIL: T037 — src/utils/manifest.ts missing 'ExecutionManifestSchema'" >&2; exit 1; }

grep -q 'export function writeManifest' src/utils/manifest.ts \
  || { echo "FAIL: T037 — src/utils/manifest.ts missing 'writeManifest'" >&2; exit 1; }

echo "PASS: T037 — Implement src/utils/manifest.ts"

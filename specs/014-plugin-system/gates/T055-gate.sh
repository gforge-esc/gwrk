#!/bin/bash
# AUTHORED
set -euo pipefail

# T055: Implement src/plugins/manifest.ts (add tier: enforcement)
FILE="src/plugins/manifest.ts"

test -f "$FILE" \
  || { echo "FAIL: T055 — file not found: $FILE" >&2; exit 1; }

grep -q "enforcement" "$FILE" \
  || { echo "FAIL: T055 — $FILE missing 'enforcement' tier in manifest schema" >&2; exit 1; }

grep -q "scope" "$FILE" \
  || { echo "FAIL: T055 — $FILE missing 'scope' field in manifest schema" >&2; exit 1; }

echo "PASS: T055 — src/plugins/manifest.ts updated with enforcement tier"
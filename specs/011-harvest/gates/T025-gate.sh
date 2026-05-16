#!/bin/bash
# AUTHORED
set -euo pipefail

file="src/commands/harvest.ts"
test -f "$file" || { echo "FAIL: T025 — file not found: $file" >&2; exit 1; }
grep -q 'harvestCommand' "$file" || { echo "FAIL: T025 — $file missing 'harvestCommand'" >&2; exit 1; }
echo "PASS: T025 — Implement src/commands/harvest.ts"

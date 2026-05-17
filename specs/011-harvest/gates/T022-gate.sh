#!/bin/bash
# AUTHORED
set -euo pipefail

file="src/utils/git.ts"
test -f "$file" || { echo "FAIL: T022 — file not found: $file" >&2; exit 1; }
grep -q 'commitFiles' "$file" || { echo "FAIL: T022 — $file missing 'commitFiles'" >&2; exit 1; }
echo "PASS: T022 — Implement src/utils/git.ts"

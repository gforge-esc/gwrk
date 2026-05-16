#!/bin/bash
# AUTHORED
set -euo pipefail

file="src/utils/config.ts"
test -f "$file" || { echo "FAIL: T024 — file not found: $file" >&2; exit 1; }
grep -q 'GITHUB_WEBHOOK_SECRET' "$file" || { echo "FAIL: T024 — $file missing 'GITHUB_WEBHOOK_SECRET'" >&2; exit 1; }
echo "PASS: T024 — Implement src/utils/config.ts"

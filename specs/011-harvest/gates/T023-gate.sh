#!/bin/bash
# AUTHORED
set -euo pipefail

file="src/server/index.ts"
test -f "$file" || { echo "FAIL: T023 — file not found: $file" >&2; exit 1; }
grep -q 'githubWebhookPlugin' "$file" || { echo "FAIL: T023 — $file missing 'githubWebhookPlugin'" >&2; exit 1; }
echo "PASS: T023 — Implement src/server/index.ts"

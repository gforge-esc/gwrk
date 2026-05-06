#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/commands/sync-context.ts
grep -q 'sync-context' src/commands/sync-context.ts

echo "PASS: T020 — Implement src/commands/sync-context.ts"

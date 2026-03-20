#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/commands/status.ts
grep -q 'backend' src/commands/status.ts

echo "PASS: T028 — Implement src/commands/status.ts"

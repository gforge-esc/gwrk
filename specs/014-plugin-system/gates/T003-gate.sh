#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/commands/plugin.ts
grep -q 'plugin list' src/commands/plugin.ts
grep -q 'plugin install' src/commands/plugin.ts
grep -q 'plugin remove' src/commands/plugin.ts

echo "PASS: T003 — Implement src/commands/plugin.ts"

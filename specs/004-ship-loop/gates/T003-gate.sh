#!/bin/bash
set -euo pipefail
# Gate: T003 — Implement src/commands/ship.ts
# Generated: assertions derived from plan Done When + file type.
# To override, add '# AUTHORED' anywhere and edit freely.

# Done When (from plan)
grep -qE 'cancelled|canceled' src/commands/ship.ts

echo "PASS: T003 — Implement src/commands/ship.ts"

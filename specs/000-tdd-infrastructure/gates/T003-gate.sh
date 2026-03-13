#!/bin/bash
set -euo pipefail
# Gate: T003 — Implement src/commands/ship.ts
# Generated: assertions derived from plan Done When + file type.
# To override, add '# AUTHORED' anywhere and edit freely.

test -f dist/commands/ship.js

echo "PASS: T003 — Implement src/commands/ship.ts"

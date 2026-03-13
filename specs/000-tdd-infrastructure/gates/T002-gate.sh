#!/bin/bash
set -euo pipefail
# Gate: T002 — Implement src/commands/tasks-generate.ts
# Generated: assertions derived from plan Done When + file type.
# To override, add '# AUTHORED' anywhere and edit freely.

test -f dist/commands/tasks-generate.js

echo "PASS: T002 — Implement src/commands/tasks-generate.ts"

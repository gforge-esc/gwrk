#!/bin/bash
set -euo pipefail
# Gate: T005 — Implement src/cli.ts
# Generated: assertions derived from plan Done When + file type.
# To override, add '# AUTHORED' anywhere and edit freely.

# Required identifiers
grep -q 'test' src/cli.ts
test -f dist/cli.js

echo "PASS: T005 — Implement src/cli.ts"

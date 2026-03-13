#!/bin/bash
set -euo pipefail
# Gate: T001 — Implement src/utils/gate-gen.ts
# Generated: assertions derived from plan Done When + file type.
# To override, add '# AUTHORED' anywhere and edit freely.

# Required identifiers
grep -q 'generateGates' src/utils/gate-gen.ts
test -f dist/utils/gate-gen.js

echo "PASS: T001 — Implement src/utils/gate-gen.ts"

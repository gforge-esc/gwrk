#!/bin/bash
set -euo pipefail
# Gate: T002 — Implement src/utils/manifest.ts
# Generated: assertions derived from plan Done When + file type.
# To override, add '# AUTHORED' anywhere and edit freely.

# Done When (from plan)
jq -e '.digest' src/utils/manifest.ts 2>/dev/null || grep -q 'digest' src/utils/manifest.ts

echo "PASS: T002 — Implement src/utils/manifest.ts"

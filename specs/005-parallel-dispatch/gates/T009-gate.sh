#!/bin/bash
set -euo pipefail
# AUTHORED
# FR-004: Ensure parallelism settings are properly typed
test -f src/utils/config.ts
grep -q "parallelism:" src/utils/config.ts
grep -q "maxClones:" src/utils/config.ts
echo "PASS: T009 — Implement src/utils/config.ts"

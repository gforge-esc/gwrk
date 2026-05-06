#!/bin/bash
set -euo pipefail
# Gate: T002 — Implement src/utils/config.ts
# Asserts: Derived from task description

test -f src/utils/config.ts
# Required identifiers
grep -q 'GwrkConfigSchema' src/utils/config.ts
grep -q 'server' src/utils/config.ts
grep -q 'parallelism' src/utils/config.ts

echo "PASS: T002 — Implement src/utils/config.ts"

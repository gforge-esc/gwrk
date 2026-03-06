#!/bin/bash
set -euo pipefail
# Gate: T005 — Implement src/utils/config.ts
# Asserts: Derived from task description

test -f src/utils/config.ts
grep -q 'GwrkConfigSchema' src/utils/config.ts

echo "PASS: T005 — Implement src/utils/config.ts"

#!/bin/bash
set -euo pipefail
# Gate: T022 — Implement src/utils/config.ts
# Asserts: Derived from task description

test -f src/utils/config.ts
grep -q 'GwrkConfigSchema' src/utils/config.ts

echo "PASS: T022 — Implement src/utils/config.ts"

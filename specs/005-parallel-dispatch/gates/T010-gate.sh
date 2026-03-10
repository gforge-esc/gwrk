#!/bin/bash
set -euo pipefail
# Gate: T010 — Implement src/utils/state.ts
# Asserts: Derived from task description

test -f src/utils/state.ts
grep -q 'TaskSchema' src/utils/state.ts

echo "PASS: T010 — Implement src/utils/state.ts"

#!/bin/bash
set -euo pipefail
# Gate: T020 — Implement src/utils/state.ts
# Asserts: Derived from task description

test -f src/utils/state.ts
test -f tasks.json

echo "PASS: T020 — Implement src/utils/state.ts"

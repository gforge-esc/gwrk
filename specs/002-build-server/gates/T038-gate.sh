#!/bin/bash
set -euo pipefail
# Gate: T038 — Implement src/server/index.ts
# Asserts: Derived from task description

test -f src/server/index.ts
grep -q 'pause' src/server/index.ts

echo "PASS: T038 — Implement src/server/index.ts"

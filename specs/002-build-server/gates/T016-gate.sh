#!/bin/bash
set -euo pipefail
# Gate: T016 — Implement src/server/context.ts
# Asserts: Derived from task description

test -f src/server/context.ts
grep -q 'compileContext' src/server/context.ts

echo "PASS: T016 — Implement src/server/context.ts"

#!/bin/bash
set -euo pipefail
# Gate: T014 — Implement src/server/context.ts
# Asserts: Derived from task description

test -f src/server/context.ts
# Required identifiers
grep -q 'compileContext' src/server/context.ts
grep -q 'writeContextToSandbox' src/server/context.ts

echo "PASS: T014 — Implement src/server/context.ts"

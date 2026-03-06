#!/bin/bash
set -euo pipefail
# Gate: T021 — Implement src/server/sandbox.ts
# Asserts: Derived from task description

test -f src/server/sandbox.ts
grep -q 'createSandbox' src/server/sandbox.ts

echo "PASS: T021 — Implement src/server/sandbox.ts"

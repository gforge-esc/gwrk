#!/bin/bash
set -euo pipefail
# Gate: T016 — Implement src/server/sandbox.ts
# Asserts: Derived from task description

test -f src/server/sandbox.ts
# Required identifiers
grep -q 'createSandbox' src/server/sandbox.ts
grep -q 'destroySandbox' src/server/sandbox.ts
grep -q 'destroyAllSandboxes' src/server/sandbox.ts
grep -q 'reapStale' src/server/sandbox.ts

echo "PASS: T016 — Implement src/server/sandbox.ts"

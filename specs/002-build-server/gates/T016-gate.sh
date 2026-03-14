#!/bin/bash
set -euo pipefail
# Gate: T016 — Implement src/server/sandbox.ts
# HARDENED: Tests behavior (SandboxManager class works, tests pass)

# Assertion #1: File exists
test -f src/server/sandbox.ts

# Assertion #2: SandboxManager class exported
grep -q 'SandboxManager' src/server/sandbox.ts

# Assertion #3: Core methods exist (actual names from implementation)
grep -q 'createSandbox' src/server/sandbox.ts
grep -q 'destroySandbox' src/server/sandbox.ts

# Assertion #4: Sandbox test exists and passes
test -f src/server/sandbox.test.ts
pnpm vitest run src/server/sandbox.test.ts > /dev/null 2>&1 || { echo "FAIL: sandbox.test.ts failed"; exit 1; }

echo "PASS: T016 — Implement src/server/sandbox.ts"

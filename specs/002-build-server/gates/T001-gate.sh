#!/bin/bash
set -euo pipefail
# AUTHORED
test -f src/server/sandbox.ts || { echo "FAIL: T001 — file not found: src/server/sandbox.ts" >&2; exit 1; }
grep -q 'export class SandboxManager' src/server/sandbox.ts || { echo "FAIL: T001 — src/server/sandbox.ts missing 'SandboxManager'" >&2; exit 1; }
grep -q 'async createSandbox' src/server/sandbox.ts || { echo "FAIL: T001 — src/server/sandbox.ts missing 'createSandbox'" >&2; exit 1; }
echo "PASS: T001 — Implement src/server/sandbox.ts"

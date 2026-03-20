#!/bin/bash
set -euo pipefail
# AUTHORED
# FR-002: Update DispatchQueue to use SandboxManager (workDir)
test -f src/server/dispatch.ts
grep -q "workDir" src/server/dispatch.ts
echo "PASS: T004 — Implement src/server/dispatch.ts"

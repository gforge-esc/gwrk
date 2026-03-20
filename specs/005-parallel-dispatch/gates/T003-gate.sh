#!/bin/bash
set -euo pipefail
# AUTHORED
# DM-001, DM-002: Update SandboxInfo and add TaskRecord
test -f src/server/types.ts
grep -q "workDir" src/server/types.ts
grep -q "export interface TaskRecord" src/server/types.ts
echo "PASS: T003 — Implement src/server/types.ts"

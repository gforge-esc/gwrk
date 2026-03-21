#!/bin/bash
# AUTHORED
set -euo pipefail

# Task T003: Modify src/server/types.ts
# DM-001, DM-002: Add TaskRecord, replace containerId with workDir

test -f src/server/types.ts \
  || { echo "FAIL: T003 — file not found: src/server/types.ts" >&2; exit 1; }

grep -q "workDir" src/server/types.ts \
  || { echo "FAIL: T003 — src/server/types.ts missing 'workDir' field (replaces containerId)" >&2; exit 1; }

grep -q "TaskRecord" src/server/types.ts \
  || { echo "FAIL: T003 — src/server/types.ts missing 'TaskRecord' interface (DM-001)" >&2; exit 1; }

! grep -q "containerId" src/server/types.ts \
  || { echo "FAIL: T003 — src/server/types.ts still has 'containerId'. Must be replaced with 'workDir'." >&2; exit 1; }

echo "PASS: T003 — Modify src/server/types.ts"

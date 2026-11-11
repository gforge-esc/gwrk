#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T007 — Modify project-discover.ts
# Generated from filesystem convention (no test file found)

test -f src/commands/project-discover.ts || { echo "FAIL: T007 — file not found: src/commands/project-discover.ts" >&2; exit 1; }

echo "PASS: T007 — Modify project-discover.ts"

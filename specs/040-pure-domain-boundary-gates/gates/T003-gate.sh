#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T003 — Create project-id.ts
# Generated from filesystem convention (no test file found)

test -f src/adapters/git/project-id.ts || { echo "FAIL: T003 — file not found: src/adapters/git/project-id.ts" >&2; exit 1; }

echo "PASS: T003 — Create project-id.ts"

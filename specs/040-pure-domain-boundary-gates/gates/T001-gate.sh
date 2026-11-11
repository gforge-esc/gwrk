#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T001 — Create architecture-boundary.ts
# Generated from filesystem convention (no test file found)

test -f tests/helpers/architecture-boundary.ts || { echo "FAIL: T001 — file not found: tests/helpers/architecture-boundary.ts" >&2; exit 1; }

echo "PASS: T001 — Create architecture-boundary.ts"

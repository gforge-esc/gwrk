#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T007 — Create manifest-discovery.ts
# Generated from filesystem convention (no test file found)

test -f src/adapters/toolchain/manifest-discovery.ts || { echo "FAIL: T007 — file not found: src/adapters/toolchain/manifest-discovery.ts" >&2; exit 1; }

echo "PASS: T007 — Create manifest-discovery.ts"

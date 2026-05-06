#!/bin/bash
set -euo pipefail
# Gate: T006 — Implement src/cli.ts
# Asserts: Derived from task description

test -f src/cli.ts
# Required identifiers
grep -q 'server' src/cli.ts

echo "PASS: T006 — Implement src/cli.ts"

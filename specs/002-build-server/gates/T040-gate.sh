#!/bin/bash
set -euo pipefail
# Gate: T040 — Implement src/server/dispatch.ts
# Asserts: Derived from task description

test -f src/server/dispatch.ts
grep -q 'pause' src/server/dispatch.ts

echo "PASS: T040 — Implement src/server/dispatch.ts"

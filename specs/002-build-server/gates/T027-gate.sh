#!/bin/bash
set -euo pipefail
# Gate: T027 — Implement src/server/dispatch.ts
# Asserts: Derived from task description

test -f src/server/dispatch.ts
grep -q 'enqueue' src/server/dispatch.ts

echo "PASS: T027 — Implement src/server/dispatch.ts"

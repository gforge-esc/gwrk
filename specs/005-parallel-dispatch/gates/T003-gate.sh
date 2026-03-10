#!/bin/bash
set -euo pipefail
# Gate: T003 — Implement src/server/dispatch.ts
# Asserts: Derived from task description

test -f src/server/dispatch.ts

echo "PASS: T003 — Implement src/server/dispatch.ts"

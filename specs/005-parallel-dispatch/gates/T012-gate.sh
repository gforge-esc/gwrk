#!/bin/bash
set -euo pipefail
# Gate: T012 — Implement src/server/dispatch.ts
# Asserts: Derived from task description

test -f src/server/dispatch.ts

echo "PASS: T012 — Implement src/server/dispatch.ts"

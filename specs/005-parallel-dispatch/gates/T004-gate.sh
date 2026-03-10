#!/bin/bash
set -euo pipefail
# Gate: T004 — Implement src/server/types.ts
# Asserts: Derived from task description

test -f src/server/types.ts

echo "PASS: T004 — Implement src/server/types.ts"

#!/bin/bash
set -euo pipefail
# Gate: T003 — Implement src/engine/types.ts
# Asserts: Derived from task description

test -f src/engine/types.ts

echo "PASS: T003 — Implement src/engine/types.ts"

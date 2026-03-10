#!/bin/bash
set -euo pipefail
# Gate: T014 — Implement src/server/types.ts
# Asserts: Derived from task description

test -f src/server/types.ts

echo "PASS: T014 — Implement src/server/types.ts"

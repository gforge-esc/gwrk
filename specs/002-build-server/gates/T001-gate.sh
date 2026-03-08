#!/bin/bash
set -euo pipefail
# Gate: T001 — Implement src/server/index.ts
# Asserts: Derived from task description

test -f src/server/index.ts

echo "PASS: T001 — Implement src/server/index.ts"

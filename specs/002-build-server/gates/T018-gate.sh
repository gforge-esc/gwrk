#!/bin/bash
set -euo pipefail
# Gate: T018 — Implement src/server/context.test.ts
# Asserts: Derived from task description

test -f src/server/context.test.ts

echo "PASS: T018 — Implement src/server/context.test.ts"

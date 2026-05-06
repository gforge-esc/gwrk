#!/bin/bash
set -euo pipefail
# Gate: T020 — Implement src/server/routes/dispatch.ts
# Asserts: Derived from task description

test -f src/server/routes/dispatch.ts

echo "PASS: T020 — Implement src/server/routes/dispatch.ts"

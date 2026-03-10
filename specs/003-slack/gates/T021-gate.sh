#!/bin/bash
set -euo pipefail
# Gate: T021 — Implement src/server/routes/health.ts
# Asserts: Derived from task description

test -f src/server/routes/health.ts

echo "PASS: T021 — Implement src/server/routes/health.ts"

#!/bin/bash
set -euo pipefail
# Gate: T011 — Implement src/server/backend-selector.ts
# Asserts: Derived from task description

test -f src/server/backend-selector.ts
grep -q 'selectBackend' src/server/backend-selector.ts

echo "PASS: T011 — Implement src/server/backend-selector.ts"

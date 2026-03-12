#!/bin/bash
set -euo pipefail
# Gate: T004 — Implement src/server/index.ts
# Asserts: Derived from task description

test -f src/server/index.ts
# Required identifiers
grep -q 'startServer' src/server/index.ts
grep -q 'stopServer' src/server/index.ts

echo "PASS: T004 — Implement src/server/index.ts"

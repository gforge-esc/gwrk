#!/bin/bash
set -euo pipefail
# Gate: T036 — Implement src/server/network.ts
# Asserts: Derived from task description

test -f src/server/network.ts
grep -q 'networkInterfaces' src/server/network.ts

echo "PASS: T036 — Implement src/server/network.ts"

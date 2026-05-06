#!/bin/bash
set -euo pipefail
# Gate: T023 — Implement src/server/network.ts
# Asserts: Derived from task description

test -f src/server/network.ts
# Required identifiers
grep -q 'networkInterfaces' src/server/network.ts

echo "PASS: T023 — Implement src/server/network.ts"

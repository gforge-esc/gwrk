#!/bin/bash
set -euo pipefail
# Gate: T014 — Implement src/server/routing-decisions.ts
# Asserts: Derived from task description

test -f src/server/routing-decisions.ts
grep -q 'recordDecision' src/server/routing-decisions.ts

echo "PASS: T014 — Implement src/server/routing-decisions.ts"

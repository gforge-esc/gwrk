#!/bin/bash
set -euo pipefail
# Gate: T006 — Implement src/utils/parser-plan.ts

test -f src/utils/parser-plan.ts
grep -q "parsePlan" src/utils/parser-plan.ts

echo "PASS: T006 — Plan parser implemented"

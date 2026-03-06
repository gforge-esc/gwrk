#!/bin/bash
set -euo pipefail
# Gate: T013 — Implement src/commands/plan.ts
# Asserts: Derived from task description

test -f src/commands/plan.ts

echo "PASS: T013 — Implement src/commands/plan.ts"

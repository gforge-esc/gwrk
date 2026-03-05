#!/bin/bash
set -euo pipefail
# Gate: T014 — Implement src/commands/plan.ts
# Asserts: Derived from task description

test -f src/commands/plan.ts

echo "PASS: T014 — Implement src/commands/plan.ts"

#!/bin/bash
set -euo pipefail
# Gate: T026 — Implement src/commands/measure.ts
# Asserts: Derived from task description

test -f src/commands/measure.ts

echo "PASS: T026 — Implement src/commands/measure.ts"

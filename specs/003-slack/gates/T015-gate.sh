#!/bin/bash
set -euo pipefail
# Gate: T015 — Implement src/commands/ship.ts
# Asserts: Derived from task description

test -f src/commands/ship.ts

echo "PASS: T015 — Implement src/commands/ship.ts"

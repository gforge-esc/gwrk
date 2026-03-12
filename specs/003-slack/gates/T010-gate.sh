#!/bin/bash
set -euo pipefail
# Gate: T010 — Implement src/commands/ship.ts
# Asserts: Derived from task description

test -f src/commands/ship.ts

echo "PASS: T010 — Implement src/commands/ship.ts"

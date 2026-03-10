#!/bin/bash
set -euo pipefail
# Gate: T010 — Implement src/commands/ship.test.ts
# Asserts: Derived from task description

test -f src/commands/ship.test.ts

echo "PASS: T010 — Implement src/commands/ship.test.ts"

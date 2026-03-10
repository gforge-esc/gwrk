#!/bin/bash
set -euo pipefail
# Gate: T017 — Implement src/commands/ship.ts
# Asserts: Derived from task description

test -f src/commands/ship.ts
grep -q 'selectBackend' src/commands/ship.ts

echo "PASS: T017 — Implement src/commands/ship.ts"

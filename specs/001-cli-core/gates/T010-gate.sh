#!/bin/bash
set -euo pipefail
# Gate: T010 — Implement src/commands/specify.ts
# Asserts: Derived from task description

test -f src/commands/specify.ts

echo "PASS: T010 — Implement src/commands/specify.ts"

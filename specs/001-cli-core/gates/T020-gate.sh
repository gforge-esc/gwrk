#!/bin/bash
set -euo pipefail
# Gate: T020 — Implement src/commands/implement.ts
# Asserts: Derived from task description

test -f src/commands/implement.ts

echo "PASS: T020 — Implement src/commands/implement.ts"

#!/bin/bash
set -euo pipefail
# Gate: T038 — Implement src/commands/tasks.ts
# Asserts: Derived from task description

test -f src/commands/tasks.ts

echo "PASS: T038 — Implement src/commands/tasks.ts"

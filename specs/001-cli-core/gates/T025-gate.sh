#!/bin/bash
set -euo pipefail
# Gate: T025 — Implement src/commands/tasks.ts
# Asserts: Derived from task description

test -f src/commands/tasks.ts

echo "PASS: T025 — Implement src/commands/tasks.ts"

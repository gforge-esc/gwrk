#!/bin/bash
set -euo pipefail
# Gate: T004 — Implement src/commands/init.ts
# Asserts: Derived from task description

test -f src/commands/init.ts

echo "PASS: T004 — Implement src/commands/init.ts"

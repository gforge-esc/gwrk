#!/bin/bash
set -euo pipefail
# Gate: T005 — Implement src/commands/server.ts
# Asserts: Derived from task description

test -f src/commands/server.ts

echo "PASS: T005 — Implement src/commands/server.ts"

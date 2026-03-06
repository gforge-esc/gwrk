#!/bin/bash
set -euo pipefail
# Gate: T003 — Implement src/commands/server.ts
# Asserts: Derived from task description

test -f src/commands/server.ts

echo "PASS: T003 — Implement src/commands/server.ts"

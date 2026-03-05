#!/bin/bash
set -euo pipefail
# Gate: T007 — Implement src/commands/new.ts
# Asserts: Derived from task description

test -f src/commands/new.ts

echo "PASS: T007 — Implement src/commands/new.ts"

#!/bin/bash
set -euo pipefail
# Gate: T023 — Implement src/commands/init.ts
# Asserts: Derived from task description

test -f src/commands/init.ts

echo "PASS: T023 — Implement src/commands/init.ts"

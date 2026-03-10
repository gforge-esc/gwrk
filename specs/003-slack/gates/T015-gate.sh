#!/bin/bash
set -euo pipefail
# Gate: T015 — Implement src/commands/define.ts
# Asserts: Derived from task description

test -f src/commands/define.ts

echo "PASS: T015 — Implement src/commands/define.ts"

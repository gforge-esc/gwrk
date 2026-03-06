#!/bin/bash
set -euo pipefail
# Gate: T011 — Implement src/commands/define.ts
# Asserts: Derived from task description

test -f src/commands/define.ts

echo "PASS: T011 — Implement src/commands/define.ts"

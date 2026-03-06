#!/bin/bash
set -euo pipefail
# Gate: T014 — Implement src/commands/wud.ts
# Asserts: Derived from task description

test -f src/commands/wud.ts

echo "PASS: T014 — Implement src/commands/wud.ts"

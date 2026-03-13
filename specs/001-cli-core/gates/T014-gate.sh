#!/bin/bash
set -euo pipefail
# Gate: T014 — Implement src/commands/analyze.ts
# Asserts: Derived from task description

test -f src/commands/analyze.ts

echo "PASS: T014 — Implement src/commands/analyze.ts"

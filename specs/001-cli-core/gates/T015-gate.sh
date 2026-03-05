#!/bin/bash
set -euo pipefail
# Gate: T015 — Implement src/commands/analyze.ts
# Asserts: Derived from task description

test -f src/commands/analyze.ts

echo "PASS: T015 — Implement src/commands/analyze.ts"

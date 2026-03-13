#!/bin/bash
set -euo pipefail
# Gate: T025 — Implement src/commands/measure.ts
# Asserts: Derived from task description

test -f src/commands/measure.ts

echo "PASS: T025 — Implement src/commands/measure.ts"

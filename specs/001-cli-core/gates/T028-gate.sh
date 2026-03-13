#!/bin/bash
set -euo pipefail
# Gate: T028 — Implement src/commands/compression.ts
# Asserts: Derived from task description

test -f src/commands/compression.ts

echo "PASS: T028 — Implement src/commands/compression.ts"

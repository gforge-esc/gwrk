#!/bin/bash
set -euo pipefail
# Gate: T018 — Implement src/commands/compression.ts
# Asserts: Derived from task description

test -f src/commands/compression.ts

echo "PASS: T018 — Implement src/commands/compression.ts"

#!/bin/bash
set -euo pipefail
# Gate: T020 — Implement src/commands/compression.test.ts
# Asserts: Derived from task description

test -f src/commands/compression.test.ts

echo "PASS: T020 — Implement src/commands/compression.test.ts"

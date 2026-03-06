#!/bin/bash
set -euo pipefail
# Gate: T015 — Implement src/db/compression.ts
# Asserts: Derived from task description

test -f src/db/compression.ts

echo "PASS: T015 — Implement src/db/compression.ts"

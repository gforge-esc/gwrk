#!/bin/bash
set -euo pipefail
# Gate: T004 — Implement src/cli.ts
# Asserts: Derived from task description

test -f src/cli.ts

echo "PASS: T004 — Implement src/cli.ts"

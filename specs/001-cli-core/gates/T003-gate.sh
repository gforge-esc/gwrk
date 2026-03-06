#!/bin/bash
set -euo pipefail
# Gate: T003 — Implement src/cli.ts
# Asserts: Derived from task description

test -f src/cli.ts

echo "PASS: T003 — Implement src/cli.ts"

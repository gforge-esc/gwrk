#!/bin/bash
set -euo pipefail
# Gate: T012 — Implement src/cli.ts
# Asserts: Derived from task description

test -f src/cli.ts

echo "PASS: T012 — Implement src/cli.ts"

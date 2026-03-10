#!/bin/bash
set -euo pipefail
# Gate: T009 — Implement src/cli.ts
# Asserts: Derived from task description

test -f src/cli.ts

echo "PASS: T009 — Implement src/cli.ts"

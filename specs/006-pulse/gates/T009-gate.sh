#!/bin/bash
set -euo pipefail
# Gate: T009 — Implement src/cli.test.ts
# Asserts: Derived from task description

test -f src/cli.test.ts

echo "PASS: T009 — Implement src/cli.test.ts"

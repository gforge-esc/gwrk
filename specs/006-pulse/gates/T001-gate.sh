#!/bin/bash
set -euo pipefail
# Gate: T001 — Implement src/utils/git.ts
# Asserts: Derived from task description

test -f src/utils/git.ts

echo "PASS: T001 — Implement src/utils/git.ts"

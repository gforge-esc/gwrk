#!/bin/bash
set -euo pipefail
# Gate: T008 — Implement src/utils/exec.ts
# Asserts: Derived from task description

test -f src/utils/exec.ts

echo "PASS: T008 — Implement src/utils/exec.ts"

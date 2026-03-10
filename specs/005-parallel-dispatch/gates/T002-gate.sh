#!/bin/bash
set -euo pipefail
# Gate: T002 — Implement src/server/sandbox.ts
# Asserts: Derived from task description

test -f src/server/sandbox.ts

echo "PASS: T002 — Implement src/server/sandbox.ts"

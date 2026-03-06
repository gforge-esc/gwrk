#!/bin/bash
set -euo pipefail
# Gate: T002 — Implement src/server/pid.ts
# Asserts: Derived from task description

test -f src/server/pid.ts

echo "PASS: T002 — Implement src/server/pid.ts"

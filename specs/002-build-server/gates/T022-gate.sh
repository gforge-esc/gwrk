#!/bin/bash
set -euo pipefail
# Gate: T022 — Implement src/server/lifecycle.ts
# Asserts: Derived from task description

test -f src/server/lifecycle.ts

echo "PASS: T022 — Implement src/server/lifecycle.ts"

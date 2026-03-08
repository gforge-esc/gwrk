#!/bin/bash
set -euo pipefail
# Gate: T030 — Implement src/server/dispatch.test.ts
# Asserts: Derived from task description

test -f src/server/dispatch.test.ts

echo "PASS: T030 — Implement src/server/dispatch.test.ts"

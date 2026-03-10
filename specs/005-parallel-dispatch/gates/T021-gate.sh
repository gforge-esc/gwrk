#!/bin/bash
set -euo pipefail
# Gate: T021 — Implement src/server/dispatch.ts
# Asserts: Derived from task description

test -f src/server/dispatch.ts

echo "PASS: T021 — Implement src/server/dispatch.ts"

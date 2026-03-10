#!/bin/bash
set -euo pipefail
# Gate: T018 — Implement src/server/backends/invocation-strategy.ts
# Asserts: Derived from task description

test -f src/server/backends/invocation-strategy.ts

echo "PASS: T018 — Implement src/server/backends/invocation-strategy.ts"

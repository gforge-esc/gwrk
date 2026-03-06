#!/bin/bash
set -euo pipefail
# Gate: T036 — Implement src/commands/metrics.ts
# Asserts: Derived from task description

test -f src/commands/metrics.ts

echo "PASS: T036 — Implement src/commands/metrics.ts"

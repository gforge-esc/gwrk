#!/bin/bash
set -euo pipefail
# Gate: T036 — Delete src/commands/metrics.ts (dead metrics group)
# Asserts: Derived from task description

! test -f src/commands/metrics.ts

echo "PASS: T036 — Delete src/commands/metrics.ts"

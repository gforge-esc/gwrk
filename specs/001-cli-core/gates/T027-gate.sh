#!/bin/bash
set -euo pipefail
# Gate: T027 — Implement src/commands/pulse.ts
# Asserts: Derived from task description

test -f src/commands/pulse.ts

echo "PASS: T027 — Implement src/commands/pulse.ts"

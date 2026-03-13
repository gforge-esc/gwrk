#!/bin/bash
set -euo pipefail
# Gate: T040 — Implement src/commands/define.ts
# Asserts: Derived from task description

test -f src/commands/define.ts

# Phase Acceptance Criteria
gwrk tasks verify <feature>
gwrk.db history

echo "PASS: T040 — Implement src/commands/define.ts"

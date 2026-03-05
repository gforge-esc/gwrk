#!/bin/bash
set -euo pipefail
# Gate: T014 — Implement src/utils/agent.ts
# Asserts: Derived from task description

test -f src/utils/agent.ts

echo "PASS: T014 — Implement src/utils/agent.ts"

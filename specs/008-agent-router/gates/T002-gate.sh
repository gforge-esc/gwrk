#!/bin/bash
set -euo pipefail
# Gate: T002 — Implement src/server/agent-registry.test.ts
# Asserts: Derived from task description

test -f src/server/agent-registry.test.ts

echo "PASS: T002 — Implement src/server/agent-registry.test.ts"

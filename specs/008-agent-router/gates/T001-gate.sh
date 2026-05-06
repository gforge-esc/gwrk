#!/bin/bash
set -euo pipefail
# Gate: T001 — Implement src/server/agent-registry.ts
# Asserts: Derived from task description

test -f src/server/agent-registry.ts
grep -q 'loadRegistry' src/server/agent-registry.ts

echo "PASS: T001 — Implement src/server/agent-registry.ts"

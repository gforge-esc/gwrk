#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/utils/agent.ts
grep -q 'AgentBackend' src/utils/agent.ts
grep -q 'dispatchToAgent' src/utils/agent.ts

echo "PASS: T019 — Implement src/utils/agent.ts"

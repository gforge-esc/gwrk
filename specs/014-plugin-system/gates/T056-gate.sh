#!/bin/bash
# AUTHORED
set -euo pipefail

# T056: src/utils/agent.ts (MODIFY: call resolveEnforcementSkills)
test -f src/utils/agent.ts \
  || { echo "FAIL: T056 — file not found: src/utils/agent.ts" >&2; exit 1; }

grep -q "resolveEnforcementSkills" src/utils/agent.ts \
  || { echo "FAIL: T056 — src/utils/agent.ts missing call to 'resolveEnforcementSkills'" >&2; exit 1; }

echo "PASS: T056 — Implement src/utils/agent.ts"

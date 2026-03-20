#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/utils/agent-layer.ts
grep -q 'stripAnsi' src/utils/agent-layer.ts
grep -q 'guardBinary' src/utils/agent-layer.ts
grep -q 'truncateOverflow' src/utils/agent-layer.ts

echo "PASS: T011 — Implement src/utils/agent-layer.ts"
